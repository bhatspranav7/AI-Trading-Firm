"""Live public market data (no API key) with an offline simulation fallback.

Sources are tried in order: Binance, then Bybit. Exchanges geo-block some hosting regions (Binance returns
HTTP 451 from Singapore and the US, for example), so a hosted firm needs a second venue. If neither
answers, the feed runs a random-walk simulation and says so in `source`.
"""
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
BINANCE_REST = "https://api.binance.com"
BINANCE_WS = "wss://stream.binance.com:9443/stream?streams="
BYBIT_REST = "https://api.bybit.com"
BYBIT_WS = "wss://stream.bybit.com/v5/public/spot"
BYBIT_INTERVAL = {"1m": "1", "3m": "3", "5m": "5", "15m": "15", "1h": "60"}
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
        self.last_error: str | None = None
        self._listeners = []
        self._task: asyncio.Task | None = None

    # ------------------------------------------------------------------ public
    def on_tick(self, cb):
        self._listeners.append(cb)

    async def start(self):
        if self.mode == "live":
            if await self._seed_binance():
                self.source = "binance"
                self._task = asyncio.create_task(self._ws_binance())
            elif await self._seed_bybit():
                self.source = "bybit"
                self._task = asyncio.create_task(self._ws_bybit())
        if self.source == "none":
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

    def _apply_candle(self, s: str, c: dict):
        dq = self.candles[s]
        if dq and dq[-1]["time"] == c["time"]:
            dq[-1] = c
        elif not dq or c["time"] > dq[-1]["time"]:
            dq.append(c)
        else:
            return
        self.price[s] = c["close"]
        self.last_tick[s] = time.time()

    # ---- Binance ----------------------------------------------------------------------------
    @staticmethod
    def _kline(k) -> dict:
        return {"time": int(k[0]) // 1000, "open": float(k[1]), "high": float(k[2]),
                "low": float(k[3]), "close": float(k[4]), "volume": float(k[5])}

    async def _seed_binance(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                for s in self.symbols:
                    r = await c.get(f"{BINANCE_REST}/api/v3/klines",
                                    params={"symbol": s, "interval": self.interval, "limit": self.history})
                    r.raise_for_status()
                    self.candles[s].clear()
                    for k in r.json():
                        self.candles[s].append(self._kline(k))
                    self.price[s] = self.candles[s][-1]["close"]
                    bt = await c.get(f"{BINANCE_REST}/api/v3/ticker/bookTicker", params={"symbol": s})
                    if bt.status_code == 200:
                        d = bt.json()
                        self.bid[s], self.ask[s] = float(d["bidPrice"]), float(d["askPrice"])
                    else:
                        self.bid[s], self.ask[s] = self.price[s] * 0.9999, self.price[s] * 1.0001
                    self.last_tick[s] = time.time()
            log.info("seeded %d candles per symbol from Binance", self.history)
            return True
        except Exception as e:  # noqa: BLE001
            self.last_error = f"Binance: {e.__class__.__name__} {str(e)[:80]}"
            log.warning("Binance seed failed (%s); trying Bybit", e)
            return False

    async def _ws_binance(self):
        streams = "/".join(f"{s.lower()}@kline_{self.interval}" for s in self.symbols)
        streams += "/" + "/".join(f"{s.lower()}@bookTicker" for s in self.symbols)
        backoff = 1
        while True:
            try:
                async with websockets.connect(BINANCE_WS + streams, ping_interval=20, ping_timeout=20,
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
                            self._apply_candle(s, {"time": int(k["t"]) // 1000, "open": float(k["o"]),
                                                   "high": float(k["h"]), "low": float(k["l"]),
                                                   "close": float(k["c"]), "volume": float(k["v"])})
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

    # ---- Bybit ------------------------------------------------------------------------------
    async def _seed_bybit(self) -> bool:
        iv = BYBIT_INTERVAL.get(self.interval, "1")
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                for s in self.symbols:
                    r = await c.get(f"{BYBIT_REST}/v5/market/kline",
                                    params={"category": "spot", "symbol": s, "interval": iv, "limit": self.history})
                    r.raise_for_status()
                    body = r.json()
                    if body.get("retCode") != 0:
                        raise RuntimeError(body.get("retMsg", "bybit error"))
                    rows = body["result"]["list"]           # newest first
                    self.candles[s].clear()
                    for k in reversed(rows):
                        self.candles[s].append(self._kline(k))
                    self.price[s] = self.candles[s][-1]["close"]
                    t = await c.get(f"{BYBIT_REST}/v5/market/tickers", params={"category": "spot", "symbol": s})
                    lst = t.json().get("result", {}).get("list", []) if t.status_code == 200 else []
                    if lst:
                        self.bid[s], self.ask[s] = float(lst[0]["bid1Price"]), float(lst[0]["ask1Price"])
                    else:
                        self.bid[s], self.ask[s] = self.price[s] * 0.9999, self.price[s] * 1.0001
                    self.last_tick[s] = time.time()
            log.info("seeded %d candles per symbol from Bybit", self.history)
            return True
        except Exception as e:  # noqa: BLE001
            self.last_error = (self.last_error or "") + f" | Bybit: {e.__class__.__name__} {str(e)[:80]}"
            log.warning("Bybit seed failed (%s); falling back to simulation", e)
            return False

    async def _ws_bybit(self):
        iv = BYBIT_INTERVAL.get(self.interval, "1")
        args = [f"kline.{iv}.{s}" for s in self.symbols] + [f"tickers.{s}" for s in self.symbols]
        backoff = 1
        while True:
            try:
                async with websockets.connect(BYBIT_WS, ping_interval=None, max_size=2 ** 20) as ws:
                    await ws.send(json.dumps({"op": "subscribe", "args": args}))
                    self.connected = True
                    backoff = 1
                    log.info("Bybit websocket connected")
                    last_ping = time.time()
                    while True:
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=5)
                        except asyncio.TimeoutError:
                            raw = None
                        if time.time() - last_ping > 20:
                            await ws.send(json.dumps({"op": "ping"}))
                            last_ping = time.time()
                        if raw is None:
                            continue
                        msg = json.loads(raw)
                        topic = msg.get("topic", "")
                        if topic.startswith("kline."):
                            s = topic.split(".")[-1]
                            if s not in self.candles:
                                continue
                            for k in msg.get("data", []):
                                self._apply_candle(s, {"time": int(k["start"]) // 1000, "open": float(k["open"]),
                                                       "high": float(k["high"]), "low": float(k["low"]),
                                                       "close": float(k["close"]), "volume": float(k["volume"])})
                            await self._emit(s)
                        elif topic.startswith("tickers."):
                            d = msg.get("data", {})
                            s = d.get("symbol")
                            if s in self.candles and d.get("bid1Price") and d.get("ask1Price"):
                                self.bid[s], self.ask[s] = float(d["bid1Price"]), float(d["ask1Price"])
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                self.connected = False
                log.warning("Bybit websocket dropped (%s); reconnecting in %ss", e, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    # ---- Simulation -------------------------------------------------------------------------
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
