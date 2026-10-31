"""SQLite trade journal so the firm can be judged over hundreds of trades, not one session."""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path


class Journal:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS trades (
                id TEXT PRIMARY KEY, symbol TEXT, side TEXT, qty REAL, entry REAL, exit REAL,
                leverage INTEGER, margin_inr REAL, notional_inr REAL, stop REAL, target REAL,
                opened_at REAL, closed_at REAL, close_reason TEXT, pnl_inr REAL, fees_inr REAL,
                desk TEXT, rationale TEXT
            );
            CREATE TABLE IF NOT EXISTS meetings (
                id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, symbol TEXT, trigger TEXT,
                decision TEXT, conviction REAL, executed INTEGER, transcript TEXT
            );
            CREATE TABLE IF NOT EXISTS equity (ts REAL, equity REAL);
            """
        )
        self.db.commit()
        cols = {r["name"] for r in self.db.execute("PRAGMA table_info(meetings)").fetchall()}
        if "decided_by" not in cols:
            self.db.execute("ALTER TABLE meetings ADD COLUMN decided_by TEXT DEFAULT 'ai'")
            self.db.commit()

    def record_trade(self, p) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (p.id, p.symbol, p.side, p.qty, p.entry, p.exit, p.leverage, p.margin_inr, p.notional_inr,
             p.stop, p.target, p.opened_at, p.closed_at, p.close_reason, p.pnl_inr, p.fees_inr,
             p.desk, p.rationale),
        )
        self.db.commit()

    def record_meeting(self, symbol, trigger, decision, conviction, executed, transcript,
                       decided_by: str = "ai") -> None:
        self.db.execute(
            "INSERT INTO meetings (ts, symbol, trigger, decision, conviction, executed, transcript, decided_by) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (time.time(), symbol, trigger, decision, conviction, int(executed), json.dumps(transcript), decided_by),
        )
        self.db.commit()

    def trades_csv(self) -> str:
        rows = self.db.execute("SELECT * FROM trades ORDER BY closed_at").fetchall()
        if not rows:
            return "id,symbol,side\n"
        keys = rows[0].keys()
        out = [",".join(keys)]
        for r in rows:
            out.append(",".join('"' + str(r[k]).replace('"', "'") + '"' if isinstance(r[k], str) else str(r[k] if r[k] is not None else "")
                                for k in keys))
        return "\n".join(out) + "\n"

    def record_equity(self, equity: float) -> None:
        self.db.execute("INSERT INTO equity VALUES (?,?)", (time.time(), equity))
        self.db.commit()

    def recent_trades(self, limit=100) -> list[dict]:
        rows = self.db.execute("SELECT * FROM trades ORDER BY closed_at DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    def recent_meetings(self, limit=50) -> list[dict]:
        rows = self.db.execute("SELECT * FROM meetings ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["transcript"] = json.loads(d["transcript"] or "[]")
            out.append(d)
        return out

    def equity_curve(self, limit=2000) -> list[dict]:
        rows = self.db.execute("SELECT ts, equity FROM equity ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in reversed(rows)]

    def stats(self) -> dict:
        rows = self.db.execute(
            "SELECT symbol, pnl_inr, close_reason, closed_at, opened_at FROM trades").fetchall()
        pnls = [r["pnl_inr"] for r in rows]
        wins = [x for x in pnls if x > 0]
        losses = [x for x in pnls if x <= 0]
        gross_win, gross_loss = sum(wins), -sum(losses)
        by_symbol: dict[str, dict] = {}
        by_reason: dict[str, int] = {}
        for r in rows:
            d = by_symbol.setdefault(r["symbol"], {"trades": 0, "pnl": 0.0, "wins": 0})
            d["trades"] += 1
            d["pnl"] += r["pnl_inr"]
            d["wins"] += 1 if r["pnl_inr"] > 0 else 0
            by_reason[r["close_reason"]] = by_reason.get(r["close_reason"], 0) + 1
        hold = [r["closed_at"] - r["opened_at"] for r in rows if r["closed_at"] and r["opened_at"]]
        eq = [r["equity"] for r in self.db.execute("SELECT equity FROM equity ORDER BY ts").fetchall()]
        peak, max_dd = (eq[0] if eq else 0.0), 0.0
        for e in eq:
            peak = max(peak, e)
            if peak:
                max_dd = max(max_dd, (peak - e) / peak * 100)
        meetings = self.db.execute("SELECT COUNT(*) AS n, SUM(executed) AS x FROM meetings").fetchone()
        by_decider = {r["decided_by"] or "ai": r["n"] for r in self.db.execute(
            "SELECT decided_by, COUNT(*) AS n FROM meetings GROUP BY decided_by").fetchall()}
        if gross_loss > 0:
            pf = gross_win / gross_loss
        else:
            pf = 99.0 if gross_win > 0 else 0.0
        return {
            "trades": len(pnls),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": (len(wins) / len(pnls) * 100) if pnls else 0.0,
            "total_pnl": sum(pnls),
            "avg_win": (gross_win / len(wins)) if wins else 0.0,
            "avg_loss": (gross_loss / len(losses)) if losses else 0.0,
            "profit_factor": pf,
            "expectancy": (sum(pnls) / len(pnls)) if pnls else 0.0,
            "best": max(pnls) if pnls else 0.0,
            "worst": min(pnls) if pnls else 0.0,
            "avg_hold_sec": (sum(hold) / len(hold)) if hold else 0.0,
            "max_drawdown_pct": max_dd,
            "meetings": meetings["n"] or 0,
            "meetings_executed": meetings["x"] or 0,
            "by_symbol": by_symbol,
            "by_reason": by_reason,
            "by_decider": by_decider,
        }
