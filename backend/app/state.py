"""Shared live state and WebSocket fan-out."""
from __future__ import annotations

import asyncio
import logging
import time
from collections import deque

log = logging.getLogger("hub")


class Hub:
    def __init__(self):
        self.clients: set = set()
        self.events: deque = deque(maxlen=200)
        self.meetings: deque = deque(maxlen=30)      # finished meetings, newest last
        self.current_meeting: dict | None = None
        self.equity_curve: deque = deque(maxlen=2000)

    # ----------------------------------------------------------- connections
    async def add(self, ws):
        self.clients.add(ws)

    def remove(self, ws):
        self.clients.discard(ws)

    async def broadcast(self, msg: dict):
        if not self.clients:
            return
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_json(msg)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self.remove(ws)

    def push(self, msg: dict):
        """Fire-and-forget broadcast from sync code."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.broadcast(msg))
        except RuntimeError:
            pass

    # ---------------------------------------------------------------- events
    def event(self, kind: str, text: str, symbol: str | None = None, **extra):
        ev = {"ts": time.time(), "kind": kind, "text": text, "symbol": symbol, **extra}
        self.events.append(ev)
        self.push({"type": "event", "event": ev})
        log.info("[%s] %s", kind, text)
        return ev

    def equity_point(self, equity: float):
        pt = {"ts": time.time(), "equity": equity}
        self.equity_curve.append(pt)
        return pt
