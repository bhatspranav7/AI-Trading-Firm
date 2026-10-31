"""Ollama client. Every decision is typed: we send a JSON schema and get structured output back."""
from __future__ import annotations

import json
import logging
import time

import httpx

log = logging.getLogger("llm")


class LLM:
    def __init__(self, url: str, model: str, timeout: float):
        self.url = url
        self.model = model
        self.timeout = timeout
        self.available = False
        self.model_found = False
        self.calls = 0
        self.failures = 0
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
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }
        t0 = time.time()
        self.calls += 1
        try:
            r = await self._client.post(f"{self.url}/api/chat", json=body)
            r.raise_for_status()
            content = r.json()["message"]["content"]
            data = json.loads(content)
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
            "avg_latency": round(self.avg_latency, 2),
            "error": self.last_error,
        }
