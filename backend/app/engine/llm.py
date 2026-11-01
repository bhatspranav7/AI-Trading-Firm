"""Model client. Every decision is typed: we send a JSON schema and get structured output back.

Two providers, same interface:
- "ollama": a local Ollama server (/api/chat with `format`=schema). Open-source, runs on your machine.
- "openai": any OpenAI-compatible chat endpoint (Groq, Together, Fireworks, OpenRouter, vLLM, or Ollama's
  own /v1). Used for hosted deployments where there is no GPU next to the web server. Groq serves open
  Llama models in well under a second, which is what a live pitch needs.
"""
from __future__ import annotations

import json
import logging
import re
import time

import httpx

log = logging.getLogger("llm")


def repair_json(text: str) -> tuple[dict, bool]:
    """Parse model output; if it was cut off mid-string or mid-object, close it and parse again.
    Returns (data, was_repaired)."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        return json.loads(text), False
    except json.JSONDecodeError:
        pass
    s = text
    in_str = esc = False
    stack: list[str] = []
    for ch in s:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch in "{[":
            stack.append(ch)
        elif ch in "}]" and stack:
            stack.pop()
    if in_str:
        s += '"'
    # a key with no value yet, or a dangling comma, cannot be closed: drop it
    s = re.sub(r'(?<=[,{])\s*"[^"]*"\s*:?\s*$', "", s)
    s = re.sub(r",\s*$", "", s)
    s += "".join("}" if c == "{" else "]" for c in reversed(stack))
    return json.loads(s), True


class LLM:
    def __init__(self, url: str, model: str, timeout: float, provider: str = "ollama", api_key: str = ""):
        self.url = url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.provider = "openai" if provider.lower() in ("openai", "groq", "compatible") else "ollama"
        self.api_key = api_key
        self.available = False
        self.model_found = False
        self.calls = 0
        self.failures = 0
        self.repairs = 0
        self.avg_latency = 0.0
        self.last_error: str | None = None
        self._client = httpx.AsyncClient(timeout=timeout)

    # ---- availability -------------------------------------------------------------------------

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    async def check(self) -> bool:
        try:
            if self.provider == "openai":
                r = await self._client.get(f"{self.url}/models", headers=self._headers(), timeout=10)
                if r.status_code in (401, 403):
                    raise PermissionError("the API key was rejected; set LLM_API_KEY")
                r.raise_for_status()
                names = [m.get("id", "") for m in r.json().get("data", [])]
                # some gateways do not list models; trust the configured name then
                base = self.model.split(":")[0]
                self.model_found = (not names) or any(
                    n == self.model or n == f"{self.model}:latest" or n.split(":")[0] == base for n in names)
                if names and not self.model_found:
                    # the catalogue moves; pick the closest open chat model rather than going dark
                    pick = self._closest(names)
                    log.warning("model %s not offered by %s; offered: %s", self.model, self.url, ", ".join(sorted(names))[:400])
                    if pick:
                        self.last_error = f"{self.model} is not offered here; using {pick}"
                        self.model = pick
                        self.model_found = True
                    else:
                        self.last_error = f"model {self.model} not offered by {self.url}"
                else:
                    self.last_error = None
            else:
                r = await self._client.get(f"{self.url}/api/tags", timeout=5)
                r.raise_for_status()
                names = [m.get("name", "") for m in r.json().get("models", [])]
                base = self.model.split(":")[0]
                self.model_found = any(
                    n == self.model or n == f"{self.model}:latest" or n.split(":")[0] == base for n in names
                )
                if not self.model_found:
                    self.last_error = f"model {self.model} not pulled; run: ollama pull {self.model}"
                    log.warning(self.last_error)
                else:
                    self.last_error = None
            self.available = True
        except Exception as e:  # noqa: BLE001
            self.available = False
            self.model_found = False
            what = str(e) if isinstance(e, PermissionError) else e.__class__.__name__
            self.last_error = f"{self.provider} endpoint unreachable at {self.url} ({what})"
        return self.available and self.model_found

    @staticmethod
    def _closest(names: list[str]) -> str | None:
        chat = [n for n in names if not any(x in n.lower() for x in ("whisper", "tts", "guard", "embed", "vision", "safeguard", "prompt"))]
        for pref in ("llama-3.1-8b", "llama-3.3-70b", "llama-4", "llama", "qwen", "gemma", "mixtral", "gpt-oss", "kimi", "deepseek"):
            hits = sorted(n for n in chat if pref in n.lower())
            if hits:
                return hits[0]
        return chat[0] if chat else None

    # ---- one typed call -----------------------------------------------------------------------

    async def ask(self, system: str, user: str, schema: dict, temperature: float = 0.7,
                  max_tokens: int = 220) -> dict | None:
        if not (self.available and self.model_found):
            return None
        t0 = time.time()
        self.calls += 1
        try:
            if self.provider == "openai":
                content = await self._ask_openai(system, user, schema, temperature, max_tokens)
            else:
                content = await self._ask_ollama(system, user, schema, temperature, max_tokens)
            data, repaired = repair_json(content)
            if repaired:
                self.repairs += 1
                if isinstance(data.get("statement"), str):
                    data["statement"] = data["statement"].rstrip(" ,;:") + "…"
                log.info("model output was cut off; repaired (%s)", content[-40:].replace(chr(10), " "))
            missing = [k for k in schema.get("required", []) if k not in data]
            if missing:
                raise ValueError(f"missing keys {missing}")
            dt = time.time() - t0
            self.avg_latency = dt if self.avg_latency == 0 else self.avg_latency * 0.8 + dt * 0.2
            return data
        except Exception as e:  # noqa: BLE001
            self.failures += 1
            self.last_error = f"{e.__class__.__name__}: {str(e)[:120]}"
            log.warning("llm call failed: %s", self.last_error)
            if isinstance(e, httpx.ConnectError):
                self.available = False
            return None

    async def _ask_ollama(self, system, user, schema, temperature, max_tokens) -> str:
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "stream": False,
            "format": schema,
            "keep_alive": "30m",
            "options": {"temperature": temperature, "num_predict": max_tokens, "num_ctx": 2048},
        }
        r = await self._client.post(f"{self.url}/api/chat", json=body)
        r.raise_for_status()
        return r.json()["message"]["content"]

    async def _ask_openai(self, system, user, schema, temperature, max_tokens) -> str:
        # JSON mode is supported everywhere; the exact shape goes into the system prompt.
        shape = {k: v.get("type", "string") + (f" one of {v['enum']}" if "enum" in v else "")
                 for k, v in schema.get("properties", {}).items()}
        system = system + "\nReply with one JSON object with exactly these keys: " + json.dumps(shape)
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": temperature,
            "max_tokens": max_tokens + 60,
            "response_format": {"type": "json_object"},
        }
        r = await self._client.post(f"{self.url}/chat/completions", json=body, headers=self._headers())
        if r.status_code == 429:
            raise RuntimeError("rate limited by the model provider")
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]

    def status(self) -> dict:
        return {
            "provider": self.provider,
            "model": self.model,
            "url": self.url,
            "available": self.available and self.model_found,
            "calls": self.calls,
            "failures": self.failures,
            "repairs": self.repairs,
            "avg_latency": round(self.avg_latency, 2),
            "error": self.last_error,
        }
