"""Risk desk sizes trades and kills bad ones. Compliance desk watches exposure limits."""
from __future__ import annotations


class RiskDesk:
    def __init__(self, settings, ledger):
        self.s = settings
        self.ledger = ledger

    def size(self, proposal: dict, snap: dict, side: str) -> tuple[dict | None, list[str]]:
        notes: list[str] = []
        cap = self.s.max_per_position * 100
        asked_lev = float(proposal.get("leverage", 1) or 1)
        lev = int(max(1, min(self.s.max_leverage, round(asked_lev))))
        if lev != round(asked_lev):
            notes.append(f"leverage clamped to {lev}x")
        size_pct = float(proposal.get("size_pct", 5) or 5)
        if size_pct > cap:
            notes.append(f"size cut from {size_pct:.0f}% to the {cap:.0f}% per-position cap")
            size_pct = cap
        room = self.s.max_committed * 100 - self.ledger.committed_pct()
        if size_pct > room:
            notes.append(f"only {max(room, 0):.0f}% of the {self.s.max_committed * 100:.0f}% firm budget is free")
            size_pct = room
        if size_pct < 2:
            return None, notes + ["not enough risk budget left; no trade"]

        a = snap.get("atr")
        price = snap.get("price")
        if not a or not price:
            return None, notes + ["ATR unavailable; cannot place a stop"]
        stop_atr = max(self.s.min_stop_atr, float(proposal.get("stop_atr", 1.5) or 1.5))
        target_atr = max(stop_atr * 1.2, float(proposal.get("target_atr", stop_atr * 2) or stop_atr * 2))
        d = 1 if side == "LONG" else -1
        fill = (snap.get("ask") if side == "LONG" else snap.get("bid")) or price
        stop = fill - d * stop_atr * a
        target = fill + d * target_atr * a

        margin = self.ledger.capital * size_pct / 100
        notional = margin * lev
        loss_at_stop = notional * (stop_atr * a / fill)
        max_loss = self.ledger.capital * self.s.max_loss_per_trade
        if loss_at_stop > max_loss:
            scale = max_loss / loss_at_stop
            size_pct *= scale
            notes.append(f"size scaled by {scale:.2f} so the stop costs at most "
                         f"{self.s.max_loss_per_trade * 100:.0f}% of capital")
            if size_pct < 2:
                return None, notes + ["stop too wide for the budget; no trade"]
            margin = self.ledger.capital * size_pct / 100
            notional = margin * lev
            loss_at_stop = max_loss

        return {
            "size_pct": size_pct, "margin_inr": margin, "notional_inr": notional, "leverage": lev,
            "fill": fill, "stop": stop, "target": target, "stop_atr": stop_atr, "target_atr": target_atr,
            "risk_inr": loss_at_stop, "rr": target_atr / stop_atr,
        }, notes


class ComplianceDesk:
    def __init__(self, settings, ledger):
        self.s = settings
        self.ledger = ledger

    def review(self, symbol: str, decision: str, snap: dict) -> tuple[bool, list[str]]:
        entering = decision in ("LONG", "SHORT", "FLIP")
        if not entering:
            return True, ["no new exposure; cleared"]
        eq = self.ledger.equity()
        if eq < self.ledger.capital * (1 - self.s.daily_loss_limit):
            return False, [f"drawdown past {self.s.daily_loss_limit * 100:.0f}% loss limit; new entries halted"]
        if decision in ("LONG", "SHORT") and symbol in self.ledger.positions:
            return False, [f"{symbol} already has an open position; one per desk"]
        if snap.get("age", 0) > 90:
            return False, ["market data stale for over 90s; cannot trade blind"]
        if (snap.get("spread_pct") or 0) > 0.15:
            return False, [f"spread {snap['spread_pct']:.2f}% too wide to fill cleanly"]
        if self.ledger.committed_pct() >= self.s.max_committed * 100 - 1:
            return False, ["firm exposure cap reached"]
        return True, [f"exposure {self.ledger.committed_pct():.0f}% of "
                      f"{self.s.max_committed * 100:.0f}% cap; cleared"]
