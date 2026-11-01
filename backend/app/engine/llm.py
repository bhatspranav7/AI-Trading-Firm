"""Ollama client. Every decision is typed: we send a JSON schema and get structured output back."""
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
    try:
        return json.loads(text), False
    except json.JSONDecodeError:
        pass
    s = text.strip()
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
    def __init__(self, url: str, model: str, timeout: float):
        self.url = url
        self.model = model
        self.timeout = timeout
        self.available = False
        self.model_found = False
        self.calls = 0
        self.failures = 0
        self.repairs = 0
        self.avg_latency = 0.0
        self.last_error: str | None = None
        self._client = httpx.AsyncClient(timeout=timeout)

    async def check(self) -> bool:
        try:
            r = await self._client.get(f"{self.url}/api/tags", timeout=5)
            r.raise_for_status()
            names = [m.get("name", "") for m in r.json().get("models", [])]
            base = self.model.split(":")[0]
            self.model_found = any(
                n == self.model or n == f"{self.model}:latest" or n.split(":")[0] == base for n in names
            )
            self.available = True
            if not self.model_found:
                self.last_error = f"model {self.model} not pulled; run: ollama pull {self.model}"
                log.warning(self.last_error)
            else:
                self.last_error = None
        except Exception as e:  # noqa: BLE001
            self.available = False
            self.model_found = False
            self.last_error = f"Ollama unreachable at {self.url} ({e.__class__.__name__})"
        return self.available and self.model_found

    async def ask(self, system: str, user: str, schema: dict, temperature: float = 0.7,
                  max_tokens: int = 220) -> dict | None:
        if not (self.available and self.model_found):
            return None
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "stream": False,
            "format": schema,
            "keep_alive": "30m",
            "options": {"temperature": temperature, "num_predict": max_tokens, "num_ctx": 2048},
        }
        t0 = time.time()
        self.calls += 1
        try:
            r = await self._client.post(f"{self.url}/api/chat", json=body)
            r.raise_for_status()
            content = r.json()["message"]["content"]
            data, repaired = repair_json(content)
            if repaired:
                self.repairs += 1
                if isinstance(data.get("statement"), str):
                    data["statement"] = data["statement"].rstrip(" ,;:") + "…"
                log.info("llm output was cut off; repaired (%s)", content[-40:].replace(chr(10), " "))
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

    def status(self) -> dict:
        return {
            "model": self.model,
            "url": self.url,
            "available": self.available and self.model_found,
            "calls": self.calls,
            "failures": self.failures,
            "repairs": self.repairs,
            "avg_latency": round(self.avg_latency, 2),
            "error": self.last_error,
        }
