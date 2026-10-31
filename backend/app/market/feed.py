"""Live Binance public market data (no API key) with an offline simulation fallback."""
from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from collections import deque

import httpx
import websockets

from . import indicators

log = logging.getLogger("feed")
REST = "https://api.binance.com"
WS = "wss://stream.binance.com:9443/stream?streams="
SIM_START = {"BTCUSDT": 77000.0, "ETHUSDT": 2500.0, "SOLUSDT": 120.0}
INTERVAL_SEC = {"1m": 60, "3m": 180, "5m": 300, "15m": 900, "1h": 3600}


class MarketFeed:
    def __init__(self, symbols, interval="1m", history=300, mode="live"):
        self.symbols = list(symbols)
        self.interval = interval
        self.history = history
        self.mode = mode
        self.candles = {s: deque(maxlen=history) for s in self.symbols}
        self.price = {s: None for s in self.symbols}
        self.bid = {s: None for s in self.symbols}
        self.ask = {s: None for s in self.symbols}
        self.last_tick = {s: 0.0 for s in self.symbols}
        self.source = "none"
        self.connected = False
        self._listeners = []
        self._task: asyncio.Task | None = None

    # ------------------------------------------------------------------ public
    def on_tick(self, cb):
        self._listeners.append(cb)

    async def start(self):
        seeded = self.mode == "live" and await self._seed()
        if seeded:
            self.source = "binance"
            self._task = asyncio.create_task(self._ws_loop())
        else:
            self._seed_sim()
            self.source = "sim"
            self._task = asyncio.create_task(self._sim_loop())
        log.info("market feed started (source=%s)", self.source)

    async def stop(self):
        if self._task:
            self._task.cancel()

    def spread_pct(self, s: str) -> float:
        b, a = self.bid.get(s), self.ask.get(s)
        if not b or not a:
            return 0.0
        return (a - b) / ((a + b) / 2) * 100

    def age(self, s: str) -> float:
        return time.time() - self.last_tick.get(s, 0)

    def snapshot(self, s: str) -> dict:
        snap = indicators.snapshot(list(self.candles[s]))
        snap.update({
            "symbol": s,
            "price": self.price[s],
            "bid": self.bid[s],
            "ask": self.ask[s],
            "spread_pct": self.spread_pct(s),
            "age": self.age(s),
        })
        return snap

    # ----------------------------------------------------------------- private
    async def _emit(self, symbol: str):
        for cb in self._listeners:
            try:
                r = cb(symbol)
                if asyncio.iscoroutine(r):
                    await r
            except Exception:
                log.exception("tick listener failed")

    @staticmethod
    def _kline(k) -> dict:
        return {"time": int(k[0]) // 1000, "open": float(k[1]), "high": float(k[2]),
                "low": float(k[3]), "close": float(k[4]), "volume": float(k[5])}

    async def _seed(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                for s in self.symbols:
                    r = await c.get(f"{REST}/api/v3/klines",
                                    params={"symbol": s, "interval": self.interval, "limit": self.history})
                    r.raise_for_status()
                    self.candles[s].clear()
                    for k in r.json():
                        self.candles[s].append(self._kline(k))
                    self.price[s] = self.candles[s][-1]["close"]
                    bt = await c.get(f"{REST}/api/v3/ticker/bookTicker", params={"symbol": s})
                    if bt.status_code == 200:
                        d = bt.json()
                        self.bid[s], self.ask[s] = float(d["bidPrice"]), float(d["askPrice"])
                    else:
                        self.bid[s], self.ask[s] = self.price[s] * 0.9999, self.price[s] * 1.0001
                    self.last_tick[s] = time.time()
            log.info("seeded %d candles per symbol from Binance", self.history)
            return True
        except Exception as e:  # noqa: BLE001
            log.warning("Binance seed failed (%s); falling back to simulation", e)
            return False

    async def _ws_loop(self):
        streams = "/".join(f"{s.lower()}@kline_{self.interval}" for s in self.symbols)
        streams += "/" + "/".join(f"{s.lower()}@bookTicker" for s in self.symbols)
        backoff = 1
        while True:
            try:
                async with websockets.connect(WS + streams, ping_interval=20, ping_timeout=20,
                                              max_size=2 ** 20) as ws:
                    self.connected = True
                    backoff = 1
                    log.info("Binance websocket connected")
                    async for raw in ws:
                        data = json.loads(raw).get("data", {})
                        s = data.get("s")
                        if s not in self.candles:
                            continue
                        if data.get("e") == "kline":
                            k = data["k"]
                            c = {"time": int(k["t"]) // 1000, "open": float(k["o"]), "high": float(k["h"]),
                                 "low": float(k["l"]), "close": float(k["c"]), "volume": float(k["v"])}
                            dq = self.candles[s]
                            if dq and dq[-1]["time"] == c["time"]:
                                dq[-1] = c
                            else:
                                dq.append(c)
                            self.price[s] = c["close"]
                            self.last_tick[s] = time.time()
                            await self._emit(s)
                        elif "b" in data and "a" in data:
                            self.bid[s], self.ask[s] = float(data["b"]), float(data["a"])
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                self.connected = False
                log.warning("websocket dropped (%s); reconnecting in %ss", e, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    def _seed_sim(self):
        step = INTERVAL_SEC.get(self.interval, 60)
        now = int(time.time()) // step * step
        for s in self.symbols:
            p = self.price.get(s) or SIM_START.get(s, 100.0)
            self.candles[s].clear()
            t0 = now - step * self.history
            for i in range(self.history):
                o = p
                vol = p * 0.0012
                c = o + random.gauss(0, vol)
                h = max(o, c) + abs(random.gauss(0, vol / 2))
                l = min(o, c) - abs(random.gauss(0, vol / 2))
                self.candles[s].append({"time": t0 + i * step, "open": o, "high": h, "low": l,
                                        "close": c, "volume": abs(random.gauss(50, 20))})
                p = c
            self.price[s] = p
            self.bid[s], self.ask[s] = p * 0.9999, p * 1.0001
            self.last_tick[s] = time.time()

    async def _sim_loop(self):
        self.connected = True
        step = INTERVAL_SEC.get(self.interval, 60)
        while True:
            await asyncio.sleep(1)
            now = int(time.time())
            for s in self.symbols:
                dq = self.candles[s]
                p = self.price[s] * (1 + random.gauss(0, 0.0003))
                bucket = now // step * step
                if dq[-1]["time"] != bucket:
                    dq.append({"time": bucket, "open": p, "high": p, "low": p, "close": p, "volume": 0.0})
                last = dq[-1]
                last["close"] = p
                last["high"] = max(last["high"], p)
                last["low"] = min(last["low"], p)
                last["volume"] += abs(random.gauss(1, 0.5))
                self.price[s] = p
                self.bid[s], self.ask[s] = p * 0.9999, p * 1.0001
                self.last_tick[s] = time.time()
                await self._emit(s)
