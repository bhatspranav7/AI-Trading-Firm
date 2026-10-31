"""Paper-trading ledger in rupees. Margin, leverage, fees, stops, targets, liquidation."""
from __future__ import annotations

import time
import uuid
from dataclasses import asdict, dataclass


@dataclass
class Position:
    id: str
    symbol: str
    side: str                 # LONG | SHORT
    qty: float                # coin units
    entry: float              # USD fill price
    leverage: int
    margin_inr: float
    notional_inr: float
    stop: float
    target: float
    opened_at: float
    desk: str
    rationale: str
    fees_inr: float = 0.0
    status: str = "open"
    mark: float | None = None
    unrealized_inr: float = 0.0
    exit: float | None = None
    closed_at: float | None = None
    close_reason: str | None = None
    pnl_inr: float = 0.0

    @property
    def direction(self) -> int:
        return 1 if self.side == "LONG" else -1

    def to_dict(self) -> dict:
        d = asdict(self)
        d["unrealized_pct"] = (self.unrealized_inr / self.margin_inr * 100) if self.margin_inr else 0.0
        return d


class Ledger:
    def __init__(self, capital_inr: float, usdinr: float, fee_rate: float):
        self.capital = capital_inr
        self.cash = capital_inr
        self.usdinr = usdinr
        self.fee_rate = fee_rate
        self.positions: dict[str, Position] = {}
        self.closed: list[Position] = []
        self.realized = 0.0
        self.fees_paid = 0.0

    # --------------------------------------------------------------- metrics
    def committed(self) -> float:
        return sum(p.margin_inr for p in self.positions.values())

    def committed_pct(self) -> float:
        return self.committed() / self.capital * 100 if self.capital else 0.0

    def unrealized(self) -> float:
        return sum(p.unrealized_inr for p in self.positions.values())

    def equity(self) -> float:
        return self.cash + self.committed() + self.unrealized()

    def summary(self) -> dict:
        eq = self.equity()
        return {
            "capital": self.capital,
            "cash": self.cash,
            "equity": eq,
            "pnl": eq - self.capital,
            "pnl_pct": (eq / self.capital - 1) * 100 if self.capital else 0.0,
            "realized": self.realized,
            "unrealized": self.unrealized(),
            "fees": self.fees_paid,
            "committed": self.committed(),
            "committed_pct": self.committed_pct(),
            "open_positions": len(self.positions),
            "closed_trades": len(self.closed),
            "usdinr": self.usdinr,
        }

    # --------------------------------------------------------------- actions
    def open(self, symbol, side, margin_inr, leverage, fill_usd, stop, target, desk, rationale) -> Position:
        if symbol in self.positions:
            raise ValueError("position already open")
        notional = margin_inr * leverage
        fee = notional * self.fee_rate
        if margin_inr + fee > self.cash:
            raise ValueError("insufficient free cash")
        qty = notional / self.usdinr / fill_usd
        p = Position(id=uuid.uuid4().hex[:8], symbol=symbol, side=side, qty=qty, entry=fill_usd,
                     leverage=leverage, margin_inr=margin_inr, notional_inr=notional, stop=stop,
                     target=target, opened_at=time.time(), desk=desk, rationale=rationale,
                     fees_inr=fee, mark=fill_usd)
        self.cash -= margin_inr + fee
        self.fees_paid += fee
        self.positions[symbol] = p
        return p

    def mark(self, symbol, bid, ask) -> Position | None:
        """Mark to market; returns the position if a stop/target/liquidation closed it."""
        p = self.positions.get(symbol)
        if not p or bid is None or ask is None:
            return None
        m = bid if p.side == "LONG" else ask
        p.mark = m
        p.unrealized_inr = (m - p.entry) * p.qty * p.direction * self.usdinr
        if p.unrealized_inr <= -p.margin_inr * 0.95:
            return self.close(symbol, m, "liquidation")
        if p.side == "LONG":
            if m <= p.stop:
                return self.close(symbol, p.stop, "stop")
            if m >= p.target:
                return self.close(symbol, p.target, "target")
        else:
            if m >= p.stop:
                return self.close(symbol, p.stop, "stop")
            if m <= p.target:
                return self.close(symbol, p.target, "target")
        return None

    def close(self, symbol, fill_usd, reason) -> Position | None:
        p = self.positions.pop(symbol, None)
        if not p:
            return None
        fee = p.qty * fill_usd * self.usdinr * self.fee_rate
        pnl = (fill_usd - p.entry) * p.qty * p.direction * self.usdinr
        p.exit = fill_usd
        p.closed_at = time.time()
        p.close_reason = reason
        p.fees_inr += fee
        p.pnl_inr = pnl - p.fees_inr
        p.status = "closed"
        p.unrealized_inr = 0.0
        p.mark = fill_usd
        self.cash += p.margin_inr + pnl - fee
        self.realized += p.pnl_inr
        self.fees_paid += fee
        self.closed.append(p)
        return p

    def close_all(self, feed, reason="kill") -> list[Position]:
        out = []
        for s in list(self.positions):
            p = self.positions[s]
            fill = feed.bid.get(s) if p.side == "LONG" else feed.ask.get(s)
            closed = self.close(s, fill or p.mark or p.entry, reason)
            if closed:
                out.append(closed)
        return out
