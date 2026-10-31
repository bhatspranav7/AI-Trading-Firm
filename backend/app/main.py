"""FastAPI server: boots the firm, streams state over WebSocket, takes the CEO's orders, serves the site."""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import ROOT, settings
from .engine.boardroom import Boardroom
from .engine.firm import Firm
from .engine.journal import Journal
from .engine.ledger import Ledger
from .engine.llm import LLM
from .engine.risk import ComplianceDesk, RiskDesk
from .market.feed import MarketFeed
from .state import Hub

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("main")

EDITABLE = {
    "ceo_mode": str, "decision_timeout_sec": int, "decision_timeout_action": str,
    "max_committed": float, "max_per_position": float, "max_leverage": int, "max_loss_per_trade": float,
    "daily_loss_limit": float, "setup_threshold": float, "meeting_interval_sec": int, "scan_interval_sec": int,
    "ollama_model": str, "ollama_url": str,
}


class Engine:
    def __init__(self):
        self.s = settings
        self.hub = Hub()
        self.feed = MarketFeed(self.s.symbols, self.s.candle_interval, self.s.history, self.s.market_mode)
        self.ledger = Ledger(self.s.capital_inr, self.s.usdinr or 84.0, self.s.fee_rate)
        self.journal = Journal(self.s.db_path)
        self.llm = LLM(self.s.ollama_url, self.s.ollama_model, self.s.ollama_timeout)
        self.firm = Firm(self.s.symbols, self.s.max_staff, self.s.hire_every_trades, self.s.coffee_chance,
                         human_ceo=self.s.ceo_mode == "human")
        self.risk = RiskDesk(self.s, self.ledger)
        self.compliance = ComplianceDesk(self.s, self.ledger)
        self.boardroom = Boardroom(self.s, self.firm, self.feed, self.ledger, self.risk, self.compliance,
                                   self.llm, self.journal, self.hub)
        self.paused = False
        self.started_at = time.time()
        self._last_push: dict[str, float] = {}
        self._tasks: list[asyncio.Task] = []

    # ------------------------------------------------------------- lifecycle
    async def start(self):
        await self._fx()
        ok = await self.llm.check()
        self.feed.on_tick(self.on_tick)
        await self.feed.start()
        # The ledger starts fresh every run, so the equity chart covers this session only;
        # the SQLite journal keeps accumulating trades and meetings across runs.
        self.hub.equity_point(self.ledger.equity())
        self._tasks = [
            asyncio.create_task(self._scan_loop()),
            asyncio.create_task(self._equity_loop()),
            asyncio.create_task(self._llm_watch()),
        ]
        self.hub.event(
            "firm",
            f"Firm opened with {len(self.firm.agents)} staff and Rs {self.s.capital_inr:,.0f} paper capital. "
            f"CEO: {'you' if self.s.ceo_mode == 'human' else self.firm.exec('CEO').name}. "
            f"Agents: {self.s.ollama_model} {'online' if ok else 'offline, heuristic mode'}. "
            f"Market: {self.feed.source}. USD/INR {self.ledger.usdinr:.2f}.",
        )

    async def stop(self):
        for t in self._tasks:
            t.cancel()
        await self.feed.stop()

    async def _fx(self):
        if self.s.usdinr > 0:
            return
        try:
            async with httpx.AsyncClient(timeout=6) as c:
                r = await c.get("https://api.exchangerate-api.com/v4/latest/USD")
                rate = float(r.json()["rates"]["INR"])
                if 50 < rate < 150:
                    self.ledger.usdinr = rate
        except Exception as e:  # noqa: BLE001
            log.warning("USD/INR fetch failed (%s); using %.2f", e, self.ledger.usdinr)

    # ----------------------------------------------------------------- loops
    async def on_tick(self, symbol: str):
        closed = self.ledger.mark(symbol, self.feed.bid[symbol], self.feed.ask[symbol])
        if closed:
            self.boardroom.on_closed(closed)
        now = time.time()
        if now - self._last_push.get(symbol, 0) >= 1.0:
            self._last_push[symbol] = now
            snap = self.feed.snapshot(symbol)
            pos = self.ledger.positions.get(symbol)
            dq = self.feed.candles[symbol]
            await self.hub.broadcast({
                "type": "tick", "symbol": symbol, "market": Boardroom._compact(snap) | {"ready": snap.get("ready")},
                "position": pos.to_dict() if pos else None, "summary": self.ledger.summary(),
                "candle": dq[-1] if dq else None,
            })

    async def _scan_loop(self):
        await asyncio.sleep(3)
        while True:
            try:
                for ev in self.firm.tick():
                    self.hub.event("office", ev)
                if not self.paused:
                    for sym in self.s.symbols:
                        trig = self.boardroom.should_meet(sym)
                        if trig and not self.boardroom.lock.locked():
                            asyncio.create_task(self.boardroom.run(sym, trig))
                            break
                await self.hub.broadcast({"type": "agents", "agents": self.firm.to_list()})
            except Exception:  # noqa: BLE001
                log.exception("scan loop error")
            await asyncio.sleep(self.s.scan_interval_sec)

    async def _equity_loop(self):
        while True:
            await asyncio.sleep(30)
            eq = self.ledger.equity()
            self.journal.record_equity(eq)
            pt = self.hub.equity_point(eq)
            await self.hub.broadcast({"type": "equity", "point": pt, "summary": self.ledger.summary()})

    async def _llm_watch(self):
        while True:
            await asyncio.sleep(60)
            before = self.llm.available and self.llm.model_found
            after = await self.llm.check()
            if after != before:
                self.hub.event("firm", f"Agent model {self.llm.model} is now {'online' if after else 'offline'}.")

    # -------------------------------------------------------------- controls
    async def kill(self) -> list:
        closed = self.ledger.close_all(self.feed, "kill")
        for p in closed:
            self.boardroom.on_closed(p)
        self.paused = True
        self.hub.event("firm", f"Kill switch: closed {len(closed)} positions and paused new meetings.")
        await self.hub.broadcast(self.snapshot())
        return closed

    async def resume(self):
        self.paused = False
        self.hub.event("firm", "Trading resumed.")
        await self.hub.broadcast(self.snapshot())

    async def force_meeting(self, symbol: str):
        if symbol not in self.s.symbols:
            raise HTTPException(404, "unknown desk")
        if self.boardroom.lock.locked():
            raise HTTPException(409, "the boardroom is occupied")
        if self.boardroom.pending_for(symbol):
            raise HTTPException(409, "that desk is already waiting on your decision")
        asyncio.create_task(self.boardroom.run(symbol, "called by the CEO"))

    async def close_position(self, symbol: str) -> dict:
        p = self.ledger.positions.get(symbol)
        if not p:
            raise HTTPException(404, "no open position on that desk")
        fill = self.feed.bid[symbol] if p.side == "LONG" else self.feed.ask[symbol]
        closed = self.ledger.close(symbol, fill or p.mark or p.entry, "ceo_close")
        self.boardroom.on_closed(closed)
        return closed.to_dict()

    async def update_settings(self, patch: dict[str, Any]) -> dict:
        changed = []
        for k, v in patch.items():
            if k not in EDITABLE or v is None:
                continue
            try:
                val = EDITABLE[k](v)
            except (TypeError, ValueError):
                raise HTTPException(400, f"bad value for {k}")
            if k == "ceo_mode" and val not in ("human", "ai"):
                raise HTTPException(400, "ceo_mode must be human or ai")
            if k == "decision_timeout_action" and val not in ("stand_down", "follow_advisor"):
                raise HTTPException(400, "decision_timeout_action must be stand_down or follow_advisor")
            if k in ("max_committed", "max_per_position", "max_loss_per_trade", "daily_loss_limit") and not 0 < val <= 1:
                raise HTTPException(400, f"{k} is a fraction between 0 and 1")
            if getattr(self.s, k) != val:
                setattr(self.s, k, val)
                changed.append(k)
        if "ceo_mode" in changed:
            self.firm.set_human_ceo(self.s.ceo_mode == "human")
        if "ollama_model" in changed or "ollama_url" in changed:
            self.llm.model = self.s.ollama_model
            self.llm.url = self.s.ollama_url.rstrip("/")
            await self.llm.check()
        if changed:
            self.hub.event("firm", "Settings changed: " + ", ".join(changed))
            await self.hub.broadcast(self.snapshot())
        return self.current_settings()

    def current_settings(self) -> dict:
        return {k: getattr(self.s, k) for k in EDITABLE} | {
            "symbols": self.s.symbols, "capital_inr": self.s.capital_inr, "fee_rate": self.s.fee_rate,
            "candle_interval": self.s.candle_interval, "auth_required": bool(self.s.ceo_passcode),
        }

    # -------------------------------------------------------------- snapshot
    def snapshot(self) -> dict:
        markets = {}
        for s in self.s.symbols:
            snap = self.feed.snapshot(s)
            markets[s] = Boardroom._compact(snap) | {"ready": snap.get("ready")}
        return {
            "type": "snapshot",
            "firm": {
                "name": "AI Trading Firm",
                "started_at": self.started_at,
                "paused": self.paused,
                "symbols": self.s.symbols,
                "market_source": self.feed.source,
                "market_connected": self.feed.connected,
                "llm": self.llm.status(),
                "limits": {"max_committed": self.s.max_committed, "max_per_position": self.s.max_per_position,
                           "max_leverage": self.s.max_leverage, "max_loss_per_trade": self.s.max_loss_per_trade,
                           "daily_loss_limit": self.s.daily_loss_limit},
                "ceo_mode": self.s.ceo_mode,
                "decision_timeout_sec": self.s.decision_timeout_sec,
                "staff": len(self.firm.agents), "max_staff": self.s.max_staff,
                "auth_required": bool(self.s.ceo_passcode),
            },
            "settings": self.current_settings(),
            "summary": self.ledger.summary(),
            "markets": markets,
            "agents": self.firm.to_list(),
            "positions": [p.to_dict() for p in self.ledger.positions.values()],
            "closed": [p.to_dict() for p in self.ledger.closed[-100:]],
            "meeting": self.hub.current_meeting,
            "meetings": list(self.hub.meetings)[-20:],
            "pending": list(self.boardroom.pending.values()),
            "events": list(self.hub.events)[-120:],
            "equity_curve": list(self.hub.equity_curve),
            "stats": self.journal.stats(),
        }


engine = Engine()


def require_ceo(x_ceo_key: str | None = Header(default=None)):
    if settings.ceo_passcode and x_ceo_key != settings.ceo_passcode:
        raise HTTPException(401, "CEO passcode required")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await engine.start()
    try:
        yield
    finally:
        await engine.stop()


app = FastAPI(title="AI Trading Firm", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class Decision(BaseModel):
    decision: str
    size_pct: float | None = None
    leverage: int | None = None
    override_risk: bool = False
    note: str = ""


# ------------------------------------------------------------------ reads
@app.get("/api/health")
async def health():
    return {"ok": True, "market": engine.feed.source, "llm": engine.llm.status(), "paused": engine.paused,
            "ceo_mode": engine.s.ceo_mode, "pending": len(engine.boardroom.pending)}


@app.get("/api/state")
async def state():
    return engine.snapshot()


@app.get("/api/pending")
async def pending():
    return list(engine.boardroom.pending.values())


@app.get("/api/candles/{symbol}")
async def candles(symbol: str, limit: int = 300):
    symbol = symbol.upper()
    if symbol not in engine.feed.candles:
        raise HTTPException(404, "unknown desk")
    return list(engine.feed.candles[symbol])[-limit:]


@app.get("/api/trades")
async def trades(limit: int = 100):
    return engine.journal.recent_trades(limit)


@app.get("/api/trades.csv")
async def trades_csv():
    return PlainTextResponse(engine.journal.trades_csv(), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=trades.csv"})


@app.get("/api/meetings")
async def meetings(limit: int = 30):
    return engine.journal.recent_meetings(limit)


@app.get("/api/stats")
async def stats():
    return engine.journal.stats()


@app.get("/api/settings")
async def get_settings():
    return engine.current_settings()


@app.get("/api/auth/check", dependencies=[Depends(require_ceo)])
async def auth_check():
    return {"ok": True}


# --------------------------------------------------------- the CEO's orders
@app.post("/api/decide/{meeting_id}", dependencies=[Depends(require_ceo)])
async def decide(meeting_id: int, body: Decision):
    try:
        m = await engine.boardroom.decide(meeting_id, body.decision.upper(), body.size_pct, body.leverage,
                                          body.override_risk, body.note)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return m


@app.post("/api/meeting/{symbol}", dependencies=[Depends(require_ceo)])
async def meeting(symbol: str):
    await engine.force_meeting(symbol.upper())
    return {"ok": True}


@app.post("/api/positions/{symbol}/close", dependencies=[Depends(require_ceo)])
async def close_position(symbol: str):
    return await engine.close_position(symbol.upper())


@app.post("/api/kill", dependencies=[Depends(require_ceo)])
async def kill():
    closed = await engine.kill()
    return {"closed": [p.to_dict() for p in closed]}


@app.post("/api/resume", dependencies=[Depends(require_ceo)])
async def resume():
    await engine.resume()
    return {"paused": engine.paused}


@app.post("/api/settings", dependencies=[Depends(require_ceo)])
async def set_settings(patch: dict[str, Any]):
    return await engine.update_settings(patch)


# ------------------------------------------------------------------ stream
@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    await engine.hub.add(websocket)
    try:
        await websocket.send_json(engine.snapshot())
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        pass
    finally:
        engine.hub.remove(websocket)


# ------------------------------------------------------------- the website
DIST = ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    async def spa(path: str):
        f = DIST / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
