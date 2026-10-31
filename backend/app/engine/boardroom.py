"""The boardroom: a desk argues, risk pushes back, compliance checks, the CEO calls it.

With a human CEO (the default) the meeting ends in a recommendation and waits for the
owner's decision, with a deadline. With an AI CEO the chief executive agent decides."""
from __future__ import annotations

import asyncio
import logging
import time

from .firm import Agent, Firm

log = logging.getLogger("boardroom")

OPINION_SCHEMA = {
    "type": "object",
    "properties": {
        "stance": {"type": "string", "enum": ["LONG", "SHORT", "NEUTRAL"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "statement": {"type": "string"},
    },
    "required": ["stance", "confidence", "statement"],
}

MD_SCHEMA = {
    "type": "object",
    "properties": {
        "stance": {"type": "string", "enum": ["LONG", "SHORT", "NEUTRAL"]},
        "size_pct": {"type": "number", "minimum": 0, "maximum": 30},
        "statement": {"type": "string"},
    },
    "required": ["stance", "size_pct", "statement"],
}

RISK_SCHEMA = {
    "type": "object",
    "properties": {
        "approve": {"type": "boolean"},
        "size_pct": {"type": "number", "minimum": 0, "maximum": 30},
        "leverage": {"type": "integer", "minimum": 1, "maximum": 10},
        "stop_atr": {"type": "number", "minimum": 0.5, "maximum": 5},
        "target_atr": {"type": "number", "minimum": 0.5, "maximum": 10},
        "statement": {"type": "string"},
    },
    "required": ["approve", "size_pct", "leverage", "stop_atr", "target_atr", "statement"],
}


def ceo_schema(options: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "decision": {"type": "string", "enum": options},
            "conviction": {"type": "number", "minimum": 0, "maximum": 1},
            "statement": {"type": "string"},
        },
        "required": ["decision", "conviction", "statement"],
    }


ROLE_BRIEF = {
    "LEAD": "You called this meeting. Name the setup you see and what you want the desk to do.",
    "QUANT": "Read the indicator stack (EMA, RSI, MACD, ATR). Base your stance on the numbers, not the story.",
    "RESEARCH": "Read the regime and the day's move. Put the setup in context: trending, ranging, volatile or exhausted.",
    "TRADER": "Judge momentum and whether the trade can actually be filled cleanly given spread and volatility.",
    "MD": "You own the P&L. Push for size when the desk agrees. Say when the room is too timid or too reckless.",
    "RISK": "You size trades and kill bad ones. Decide approve or reject, size as % of capital, leverage, and stop and target as ATR multiples. Be stingy.",
    "CEO": "You make the final call. Weigh the whole room, not the loudest voice. Stand down or hold when the room is split or conviction is thin.",
    "ADVISOR": "You advise the CEO, who will make the final call. Recommend one option, give your conviction, and say in one sentence why, naming who in the room you side with.",
}

HUMAN_CEO = {"agent_id": "ceo-human", "name": "You", "role": "CEO", "title": "Chief Executive Officer", "desk": None}


class Boardroom:
    def __init__(self, settings, firm: Firm, feed, ledger, risk, compliance, llm, journal, hub):
        self.s = settings
        self.firm = firm
        self.feed = feed
        self.ledger = ledger
        self.risk = risk
        self.compliance = compliance
        self.llm = llm
        self.journal = journal
        self.hub = hub
        self.lock = asyncio.Lock()
        self.last_meeting = {sym: 0.0 for sym in settings.symbols}
        self.pending: dict[int, dict] = {}          # meeting id -> meeting awaiting the CEO
        self._risk_ops: dict[int, dict] = {}        # meeting id -> raw risk proposal
        self._timeouts: dict[int, asyncio.Task] = {}
        self._mid = 0

    # ------------------------------------------------------------ scheduling
    @property
    def human(self) -> bool:
        return self.s.ceo_mode == "human"

    def pending_for(self, symbol: str) -> dict | None:
        return next((m for m in self.pending.values() if m["symbol"] == symbol), None)

    def should_meet(self, symbol: str) -> str | None:
        if self.pending_for(symbol):
            return None
        snap = self.feed.snapshot(symbol)
        if not snap.get("ready"):
            return None
        since = time.time() - self.last_meeting[symbol]
        if since < self.s.min_meeting_gap_sec:
            return None
        if self.lock.locked() and since < self.s.meeting_interval_sec:
            return None
        if abs(snap["score"]) >= self.s.setup_threshold:
            return "setup spotted"
        if symbol in self.ledger.positions and since >= self.s.meeting_interval_sec / 2:
            return "position review"
        if since >= self.s.meeting_interval_sec:
            return "scheduled review"
        return None

    async def run(self, symbol: str, trigger: str) -> dict | None:
        if self.pending_for(symbol):
            raise ValueError(f"{symbol} already has a decision waiting on the CEO")
        async with self.lock:
            self.last_meeting[symbol] = time.time()
            try:
                return await self._run(symbol, trigger)
            except Exception:  # noqa: BLE001
                log.exception("meeting failed")
                self.hub.current_meeting = None
                self.firm.set_status(self.firm.agents, "working")
                return None

    # --------------------------------------------------------------- meeting
    async def _run(self, symbol: str, trigger: str) -> dict:
        snap = self.feed.snapshot(symbol)
        pos = self.ledger.positions.get(symbol)
        desk = [a for a in self.firm.desk(symbol) if a.status != "arriving"]
        execs = [self.firm.exec(r) for r in ("CEO", "MD", "RISK", "COMPLIANCE")]
        self.firm.set_status(desk + execs, "boardroom")

        self._mid += 1
        meeting = {
            "id": self._mid, "symbol": symbol, "trigger": trigger, "started": time.time(),
            "status": "live", "transcript": [], "decision": None, "conviction": None,
            "executed": False, "outcome": "", "snapshot": self._compact(snap),
            "attendees": [a.id for a in desk + execs], "decided_by": None,
            "position": pos.to_dict() if pos else None,
        }
        self.hub.current_meeting = meeting
        lead = next((a for a in desk if a.role == "LEAD"), desk[0])
        self.hub.event("meeting", f"{lead.name} called the {symbol[:3]} desk to the boardroom: {trigger}", symbol)
        self.hub.push({"type": "meeting", "meeting": meeting})

        ctx = self._context(symbol, snap, pos)
        traders = [a for a in desk if a.role == "TRADER"]
        if len(traders) > 1:
            traders = [traders[self._mid % len(traders)]]
        speakers = ([lead] + [a for a in desk if a.role == "QUANT"] + [a for a in desk if a.role == "RESEARCH"]
                    + traders + [self.firm.exec("MD")])

        votes: list[tuple[str, float, float]] = []
        for a in speakers:
            op = await self._opinion(a, ctx, meeting["transcript"], snap, pos)
            self._say(meeting, a, op)
            if op["stance"] in ("LONG", "SHORT"):
                votes.append((op["stance"], float(op["confidence"]), a.risk_appetite))
            await asyncio.sleep(0.2)

        side, consensus = self._tally(votes)
        md_size = next((e.get("size_pct") for e in reversed(meeting["transcript"]) if e["role"] == "MD"), None)

        risk_agent = self.firm.exec("RISK")
        risk_op = await self._risk(risk_agent, ctx, meeting["transcript"], snap, side, consensus, md_size)
        sized, notes = (None, ["no side to size"])
        if side:
            sized, notes = self.risk.size(risk_op, snap, side)
        risk_op["approve"] = bool(risk_op.get("approve")) and sized is not None
        risk_op["notes"] = notes
        risk_op["sized"] = sized
        risk_op["side"] = side
        self._say(meeting, risk_agent, {"stance": side or "NEUTRAL", "confidence": consensus,
                                        "statement": risk_op["statement"], "source": risk_op["source"],
                                        "approve": risk_op["approve"], "notes": notes,
                                        "sized": self._compact_sized(sized)})

        options = ["HOLD", "CLOSE", "FLIP"] if pos else ["LONG", "SHORT", "STAND_DOWN"]
        ceo_agent = self.firm.exec("CEO")
        ceo = await self._ceo(ceo_agent, ctx, meeting["transcript"], options, side, consensus, risk_op, pos, snap)
        decision, conviction = ceo["decision"], float(ceo["conviction"])
        demoted = None
        if conviction < 0.5 and decision in ("LONG", "SHORT", "FLIP"):
            demoted = decision
            decision = "HOLD" if pos else "STAND_DOWN"

        comp_agent = self.firm.exec("COMPLIANCE")
        comp_ok, comp_notes = self.compliance.review(symbol, decision, snap)
        self._say(meeting, comp_agent, {"stance": "NEUTRAL", "confidence": 1.0, "source": "rule",
                                        "statement": ("Cleared. " if comp_ok else "Blocked. ") + "; ".join(comp_notes),
                                        "approve": comp_ok})

        ceo_entry = {"stance": decision, "confidence": conviction, "statement": ceo["statement"],
                     "source": ceo["source"], "decision": decision, "recommendation": self.human}
        if demoted:
            ceo_entry["statement"] += f" (Wanted {demoted}, but conviction under 50%, so {decision}.)"
        self._say(meeting, ceo_agent, ceo_entry)

        meeting["options"] = options
        meeting["consensus"] = {"side": side, "strength": consensus}
        meeting["risk"] = {"approve": risk_op["approve"], "sized": self._compact_sized(sized), "notes": notes,
                           "side": side}
        meeting["compliance"] = {"ok": comp_ok, "notes": comp_notes}
        meeting["recommendation"] = {"decision": decision, "conviction": conviction, "statement": ceo["statement"],
                                     "by": ceo_agent.name}
        self._risk_ops[meeting["id"]] = risk_op
        self.firm.set_status(desk + execs, "working")
        for a in desk + execs:
            a.meetings += 1

        if self.human:
            meeting["status"] = "awaiting_ceo"
            meeting["deadline"] = time.time() + self.s.decision_timeout_sec
            self.pending[meeting["id"]] = meeting
            self.hub.current_meeting = None
            self.hub.meetings.append(meeting)
            self.hub.event("decision_needed",
                           f"{symbol[:3]} desk is waiting on you. {ceo_agent.name} recommends {decision.replace('_', ' ')} "
                           f"at {conviction:.0%} conviction.", symbol, meeting_id=meeting["id"], decision=decision)
            self.hub.push({"type": "meeting", "meeting": meeting})
            self.hub.push({"type": "pending", "pending": list(self.pending.values())})
            self.hub.push({"type": "agents", "agents": self.firm.to_list()})
            self._timeouts[meeting["id"]] = asyncio.create_task(self._timeout(meeting["id"]))
            return meeting

        outcome, executed = self._execute(symbol, decision, snap, risk_op, comp_ok, comp_notes, pos,
                                          ceo["statement"], override_risk=False)
        self._finish(meeting, decision, conviction, outcome, executed, "ai")
        return meeting

    # --------------------------------------------------------- the CEO's call
    async def decide(self, meeting_id: int, decision: str, size_pct: float | None = None,
                     leverage: int | None = None, override_risk: bool = False, note: str = "",
                     by: str = "human") -> dict:
        meeting = self.pending.get(meeting_id)
        if not meeting:
            raise ValueError("no decision is waiting for that meeting")
        if decision not in meeting["options"]:
            raise ValueError(f"decision must be one of {meeting['options']}")
        self.pending.pop(meeting_id, None)
        t = self._timeouts.pop(meeting_id, None)
        if t and not t.done():
            t.cancel()

        symbol = meeting["symbol"]
        snap = self.feed.snapshot(symbol)
        pos = self.ledger.positions.get(symbol)
        risk_op = dict(self._risk_ops.pop(meeting_id, {}) or {"approve": False, "statement": "", "side": None})
        if size_pct is not None:
            risk_op["size_pct"] = float(size_pct)
        if leverage is not None:
            risk_op["leverage"] = int(leverage)
        comp_ok, comp_notes = self.compliance.review(symbol, decision, snap)

        who = dict(HUMAN_CEO) if by == "human" else {**HUMAN_CEO, "name": "Deadline passed", "title": "default action"}
        statement = note.strip() or (
            f"{decision.replace('_', ' ')}." if by == "human"
            else f"No decision within {self.s.decision_timeout_sec // 60} minutes. Default: {decision.replace('_', ' ')}."
        )
        extra = {"stance": decision, "confidence": 1.0 if by == "human" else 0.0, "statement": statement,
                 "source": by, "decision": decision}
        if override_risk:
            extra["override"] = True
        self._say(meeting, who, extra)

        outcome, executed = self._execute(symbol, decision, snap, risk_op, comp_ok, comp_notes, pos, statement,
                                          override_risk=override_risk)
        conviction = meeting["recommendation"]["conviction"] if meeting.get("recommendation") else 0.0
        self._finish(meeting, decision, conviction, outcome, executed, by)
        self.hub.push({"type": "pending", "pending": list(self.pending.values())})
        return meeting

    async def _timeout(self, meeting_id: int):
        try:
            await asyncio.sleep(self.s.decision_timeout_sec)
        except asyncio.CancelledError:
            return
        m = self.pending.get(meeting_id)
        if not m:
            return
        rec = (m.get("recommendation") or {}).get("decision")
        if self.s.decision_timeout_action == "follow_advisor" and rec in m["options"]:
            decision = rec
        else:
            decision = "HOLD" if m.get("position") else "STAND_DOWN"
        try:
            await self.decide(meeting_id, decision, by="timeout")
        except Exception:  # noqa: BLE001
            log.exception("timeout decision failed")

    def _finish(self, meeting, decision, conviction, outcome, executed, decided_by):
        meeting.update({"status": "done", "ended": time.time(), "decision": decision, "conviction": conviction,
                        "outcome": outcome, "executed": executed, "decided_by": decided_by})
        meeting.pop("deadline", None)
        self.journal.record_meeting(meeting["symbol"], meeting["trigger"], decision, conviction, executed,
                                    meeting["transcript"], decided_by)
        if meeting not in self.hub.meetings:
            self.hub.meetings.append(meeting)
        self.hub.current_meeting = None
        who = {"ai": self.firm.exec("CEO").name, "human": "You", "timeout": "Deadline"}.get(decided_by, decided_by)
        self.hub.event("decision", f"{who}: {decision.replace('_', ' ')} on {meeting['symbol'][:3]}. {outcome}",
                       meeting["symbol"], decision=decision, decided_by=decided_by)
        self.hub.push({"type": "meeting", "meeting": meeting})
        self.hub.push({"type": "agents", "agents": self.firm.to_list()})

    # --------------------------------------------------------------- helpers
    def _say(self, meeting: dict, agent, op: dict):
        if isinstance(agent, Agent):
            ident = {"agent_id": agent.id, "name": agent.name, "role": agent.role, "title": agent.title,
                     "desk": agent.desk}
        else:
            ident = {k: agent[k] for k in ("agent_id", "name", "role", "title", "desk")}
        entry = {
            "ts": time.time(), **ident,
            "stance": op.get("stance", "NEUTRAL"),
            "confidence": round(float(op.get("confidence", 0.5)), 2),
            "statement": str(op.get("statement", "")).strip()[:400],
            "source": op.get("source", "llm"),
        }
        for k in ("approve", "notes", "sized", "decision", "size_pct", "recommendation", "override"):
            if k in op and op[k] is not None:
                entry[k] = op[k]
        meeting["transcript"].append(entry)
        if isinstance(agent, Agent):
            agent.last_statement = entry["statement"]
            agent.last_stance = entry["stance"]
            agent.calls += 1
        self.hub.push({"type": "statement", "meeting_id": meeting["id"], "entry": entry})

    @staticmethod
    def _tally(votes) -> tuple[str | None, float]:
        if not votes:
            return None, 0.0
        long_w = sum(c for s, c, _ in votes if s == "LONG")
        short_w = sum(c for s, c, _ in votes if s == "SHORT")
        total = long_w + short_w
        if total == 0:
            return None, 0.0
        side = "LONG" if long_w >= short_w else "SHORT"
        return side, max(long_w, short_w) / total * min(1.0, total / len(votes) + 0.3)

    @staticmethod
    def _compact(snap: dict) -> dict:
        keys = ("price", "bid", "ask", "spread_pct", "rsi", "ema9", "ema21", "ema50", "macd_hist", "macd_rising",
                "atr", "atr_pct", "chg_15", "chg_60", "vol_ratio", "hi_60", "lo_60", "regime", "score")
        return {k: snap.get(k) for k in keys}

    @staticmethod
    def _compact_sized(sized: dict | None) -> dict | None:
        if not sized:
            return None
        return {k: round(v, 4) if isinstance(v, float) else v for k, v in sized.items()}

    def _brief(self, ctx: str) -> str:
        """Shared system prompt for every speaker in a meeting. Identical text first so the model's
        prompt cache can reuse it; on a CPU-only box prompt evaluation is the slow part."""
        return (
            "Boardroom meeting at an AI crypto trading firm. Paper money, live Binance prices. Firm rules: at most "
            f"{self.s.max_committed * 100:.0f}% of capital committed, {self.s.max_per_position * 100:.0f}% per position, "
            f"{self.s.max_leverage}x leverage, {self.s.max_loss_per_trade * 100:.0f}% of capital at risk per trade.\n"
            f"{ctx}\n"
            "Speakers talk in first person, one or two sentences, under 35 words, like traders to colleagues. "
            "Do not repeat a colleague's words; add something new from your own job and quote the numbers you rely on. "
            "Disagree by name when you see it differently. Never mention AI. Reply only with JSON matching the schema."
        )

    def _persona(self, agent: Agent) -> str:
        brief_key = "ADVISOR" if (agent.role == "CEO" and self.human) else agent.role
        return (f"You are {agent.name}, {agent.title}. {agent.personality} Risk appetite: {agent.appetite_word()}.\n"
                f"Your job: {ROLE_BRIEF[brief_key]}")

    def _context(self, symbol: str, snap: dict, pos) -> str:
        p = snap["price"]
        e9, e21, e50 = snap["ema9"], snap["ema21"], snap["ema50"]
        stack = "bullish" if e9 > e21 > e50 else "bearish" if e9 < e21 < e50 else "mixed"
        rsi = snap.get("rsi") or 50.0
        hist = snap.get("macd_hist") or 0.0
        lines = [
            f"Desk: {symbol}. Price ${p:,.2f}. Bid/ask spread {snap['spread_pct']:.3f}%.",
            f"Move: 15m {snap['chg_15']:+.2f}%, 1h {snap['chg_60']:+.2f}%. Volume vs 1h average {snap['vol_ratio']:.1f}x.",
            f"EMA9 {e9:,.2f} / EMA21 {e21:,.2f} / EMA50 {e50:,.2f}: price {'above' if p > e50 else 'below'} EMA50, stack {stack}.",
            f"RSI(14) {rsi:.1f}. MACD histogram {hist:+.2f} ({'rising' if snap.get('macd_rising') else 'falling'}). "
            f"ATR(14) ${snap['atr']:,.2f} ({snap['atr_pct']:.2f}% of price).",
            f"60-minute range ${snap['lo_60']:,.2f} to ${snap['hi_60']:,.2f}. Regime: {snap['regime']}. "
            f"Indicator bias score {snap['score']:+.2f} (-1 strongly bearish, +1 strongly bullish).",
        ]
        if pos:
            lines.append(
                f"Open position: {pos.side} {pos.qty:.4f} {symbol[:3]} from ${pos.entry:,.2f} at {pos.leverage}x, "
                f"stop ${pos.stop:,.2f}, target ${pos.target:,.2f}, unrealized Rs {pos.unrealized_inr:+,.0f} "
                f"({pos.unrealized_inr / pos.margin_inr * 100:+.1f}% on margin)."
            )
        else:
            lines.append("Open position: none on this desk.")
        s = self.ledger.summary()
        lines.append(
            f"Firm: equity Rs {s['equity']:,.0f} ({s['pnl_pct']:+.2f}%), {s['committed_pct']:.0f}% of capital committed "
            f"(cap {self.s.max_committed * 100:.0f}%), {s['open_positions']} open positions, fees {self.s.fee_rate * 100:.2f}% per side."
        )
        return "\n".join(lines)

    @staticmethod
    def _colleagues(transcript: list[dict]) -> str:
        if not transcript:
            return "Nobody has spoken yet."
        return "\n".join(f"- {e['name']} ({e['title']}) [{e['stance']} {e['confidence']:.0%}]: {e['statement'][:160]}"
                         for e in transcript)

    async def _opinion(self, agent: Agent, ctx: str, transcript: list[dict], snap: dict, pos) -> dict:
        q = ("Give your stance (LONG, SHORT or NEUTRAL), your confidence from 0 to 1, and what you say to the room."
             if not pos else
             "The desk already holds this position. Give your stance on where price goes next (LONG, SHORT or NEUTRAL), "
             "your confidence from 0 to 1, and what you say to the room about holding, closing or flipping.")
        user = f"{self._persona(agent)}\n\nColleagues so far:\n{self._colleagues(transcript)}\n\n{q}"
        schema = MD_SCHEMA if agent.role == "MD" else OPINION_SCHEMA
        if agent.role == "MD":
            user += " Also give size_pct, the share of capital you want committed (0 to 30)."
        data = await self.llm.ask(self._brief(ctx), user, schema, agent.temperature)
        if data is None:
            data = self._heuristic_opinion(agent, snap, pos)
            data["source"] = "heuristic"
        else:
            data["source"] = "llm"
            data["confidence"] = max(0.0, min(1.0, float(data.get("confidence", 0.5))))
        return data

    async def _risk(self, agent: Agent, ctx: str, transcript, snap, side, consensus, md_size) -> dict:
        if not side:
            return {"approve": False, "size_pct": 0, "leverage": 1, "stop_atr": 1.5, "target_atr": 3,
                    "statement": "Nobody in the room has a side. I am not sizing a trade that does not exist.",
                    "source": "rule"}
        user = (f"{self._persona(agent)}\n\nThe room so far:\n{self._colleagues(transcript)}\n\n"
                f"The room leans {side} with consensus {consensus:.0%}."
                + (f" The MD asked for {md_size:.0f}% of capital." if md_size is not None else "")
                + " Decide: approve or reject, size_pct of capital, leverage (1-5), stop_atr and target_atr as ATR "
                  "multiples (stop at least 0.8, target at least 1.2x the stop). Then say it to the room.")
        data = await self.llm.ask(self._brief(ctx), user, RISK_SCHEMA, agent.temperature)
        if data is None:
            data = self._heuristic_risk(snap, consensus, md_size)
            data["source"] = "heuristic"
        else:
            data["source"] = "llm"
        return data

    async def _ceo(self, agent: Agent, ctx: str, transcript, options, side, consensus, risk_op, pos, snap) -> dict:
        risk_line = ("Risk desk APPROVED: " if risk_op["approve"] else "Risk desk REJECTED: ") + risk_op["statement"]
        if risk_op.get("sized"):
            z = risk_op["sized"]
            risk_line += (f" Sized at {z['size_pct']:.1f}% of capital, {z['leverage']}x, stop ${z['stop']:,.2f}, "
                          f"target ${z['target']:,.2f}, risk Rs {z['risk_inr']:,.0f}, reward/risk {z['rr']:.1f}.")
        ask = ("Give your recommendation to the CEO, your conviction 0-1, and one sentence of reasoning."
               if self.human else "Give decision, conviction 0-1, and what you tell the room.")
        user = (f"{self._persona(agent)}\n\nThe meeting:\n{self._colleagues(transcript)}\n\n{risk_line}\n\n"
                f"Room consensus: {side or 'none'} at {consensus:.0%}. Options: {', '.join(options)}. {ask} "
                f"If risk rejected, you cannot open or flip; stand down or hold.")
        data = await self.llm.ask(self._brief(ctx), user, ceo_schema(options), agent.temperature)
        if data is None or data.get("decision") not in options:
            data = self._heuristic_ceo(options, side, consensus, risk_op, pos)
            data["source"] = "heuristic"
        else:
            data["source"] = "llm"
            data["conviction"] = max(0.0, min(1.0, float(data.get("conviction", 0.5))))
        if not risk_op["approve"] and data["decision"] in ("LONG", "SHORT", "FLIP"):
            data["decision"] = "HOLD" if pos else "STAND_DOWN"
            data["statement"] += " Risk said no, so we stand aside."
        return data

    # ---------------------------------------------------- heuristic fallbacks
    @staticmethod
    def _heuristic_opinion(agent: Agent, snap: dict, pos) -> dict:
        score = snap["score"]
        rsi = snap.get("rsi") or 50
        contrarian = any(w in agent.personality.lower() for w in ("contrarian", "mean-reversion", "fade"))
        stance = "LONG" if score > 0 else "SHORT"
        if contrarian and abs(rsi - 50) > 18:
            stance = "SHORT" if rsi > 50 else "LONG"
        conf = min(0.95, abs(score) * 0.8 + 0.15) * (0.7 + 0.5 * agent.risk_appetite)
        conf = max(0.1, min(0.95, conf))
        if abs(score) < 0.15 and not contrarian:
            stance, conf = "NEUTRAL", 0.3
        templates = {
            "LEAD": f"Stack reads {snap['regime']} with bias {score:+.2f}; I want us {stance.lower()} if risk signs off.",
            "QUANT": f"RSI {rsi:.0f}, MACD histogram {'rising' if snap.get('macd_rising') else 'falling'}; numbers say {stance.lower()}.",
            "RESEARCH": f"Regime is {snap['regime']}, 1h move {snap['chg_60']:+.2f}%. Context supports {stance.lower()} but keep it modest.",
            "TRADER": f"Spread {snap['spread_pct']:.3f}%, ATR {snap['atr_pct']:.2f}%. Fillable. I'd go {stance.lower()} on momentum.",
            "MD": f"If the desk agrees, size it properly. {stance} with real money behind it, not a toe in the water.",
        }
        out = {"stance": stance, "confidence": round(conf, 2),
               "statement": templates.get(agent.role, f"I lean {stance.lower()}.")}
        if agent.role == "MD":
            out["size_pct"] = round(8 + 12 * agent.risk_appetite * conf, 1)
        return out

    @staticmethod
    def _heuristic_risk(snap: dict, consensus: float, md_size) -> dict:
        approve = consensus >= 0.55 and abs(snap["score"]) >= 0.25
        size = min(12.0, (md_size or 8.0) * 0.6)
        lev = 2 if snap["atr_pct"] < 0.2 else 1
        stmt = (f"Approved at {size:.0f}%, {lev}x, stop 1.5 ATR, target 3 ATR. Consensus {consensus:.0%} is enough."
                if approve else
                f"Rejected. Consensus {consensus:.0%} and bias {snap['score']:+.2f} do not earn capital.")
        return {"approve": approve, "size_pct": size, "leverage": lev, "stop_atr": 1.5, "target_atr": 3.0,
                "statement": stmt}

    @staticmethod
    def _heuristic_ceo(options, side, consensus, risk_op, pos) -> dict:
        if pos:
            against = side and side != pos.side and consensus >= 0.6
            if against and risk_op["approve"]:
                return {"decision": "FLIP", "conviction": consensus, "statement": "The room turned. Flip it."}
            if against:
                return {"decision": "CLOSE", "conviction": consensus,
                        "statement": "The room turned and risk won't size the other way. Close it."}
            return {"decision": "HOLD", "conviction": max(0.5, consensus), "statement": "Nothing has changed enough. Hold."}
        if side and risk_op["approve"] and consensus >= 0.55:
            return {"decision": side, "conviction": consensus, "statement": f"Room agrees, risk approves. {side}."}
        return {"decision": "STAND_DOWN", "conviction": 1 - consensus if side else 0.8,
                "statement": "Split room or thin edge. Stand down."}

    # -------------------------------------------------------------- execution
    def _execute(self, symbol, decision, snap, risk_op, comp_ok, comp_notes, pos, rationale,
                 override_risk: bool) -> tuple[str, bool]:
        if decision == "STAND_DOWN":
            return "Stood down.", False
        if decision == "HOLD":
            return "Holding the position.", False
        if decision == "CLOSE":
            if not pos:
                return "Nothing to close.", False
            fill = snap["bid"] if pos.side == "LONG" else snap["ask"]
            p = self.ledger.close(symbol, fill, "ceo_close")
            self.on_closed(p)
            return f"Closed {p.side} at ${fill:,.2f} for Rs {p.pnl_inr:+,.0f}.", True
        if not comp_ok:
            return "Blocked by compliance: " + "; ".join(comp_notes), False
        if decision == "FLIP" and not pos:
            return "Nothing to flip.", False
        if not risk_op.get("approve") and not override_risk:
            return "Risk desk vetoed; no trade. (CEO can override.)", False
        new_side = decision if decision in ("LONG", "SHORT") else ("SHORT" if pos.side == "LONG" else "LONG")
        sized, notes = self.risk.size(risk_op, snap, new_side)
        if not sized:
            return "Risk could not size it: " + "; ".join(notes), False
        if decision == "FLIP":
            fill = snap["bid"] if pos.side == "LONG" else snap["ask"]
            p = self.ledger.close(symbol, fill, "flip")
            self.on_closed(p)
        try:
            p = self.ledger.open(symbol, new_side, sized["margin_inr"], sized["leverage"], sized["fill"],
                                 sized["stop"], sized["target"], symbol, rationale)
        except ValueError as e:
            return f"Order rejected: {e}.", False
        if override_risk and not risk_op.get("approve"):
            self.hub.event("override", f"CEO overrode the risk desk on {symbol[:3]}.", symbol)
        self.hub.event(
            "trade",
            f"{new_side} {symbol[:3]} {p.qty:.4f} at ${p.entry:,.2f}, {p.leverage}x, margin Rs {p.margin_inr:,.0f}, "
            f"stop ${p.stop:,.2f}, target ${p.target:,.2f}",
            symbol, side=new_side,
        )
        self.hub.push({"type": "positions", "positions": [x.to_dict() for x in self.ledger.positions.values()],
                       "summary": self.ledger.summary()})
        return (f"{'Flipped to' if decision == 'FLIP' else 'Opened'} {new_side} {p.qty:.4f} at ${p.entry:,.2f}, "
                f"{p.leverage}x, {sized['size_pct']:.1f}% of capital."), True

    def on_closed(self, p):
        """Shared hook for every close: CEO, flip, stop, target, liquidation, kill."""
        if not p:
            return
        self.journal.record_trade(p)
        self.hub.event(
            "close",
            f"{p.side} {p.symbol[:3]} closed on {p.close_reason} at ${p.exit:,.2f}: Rs {p.pnl_inr:+,.0f}",
            p.symbol, pnl=p.pnl_inr, reason=p.close_reason,
        )
        hire = self.firm.on_trade_closed(p.symbol)
        if hire:
            self.hub.event("hire", f"The firm hired {hire.name} as {hire.title} for the {p.symbol[:3]} desk. "
                                   f"Walking in through reception now.", p.symbol)
        self.hub.push({"type": "positions", "positions": [x.to_dict() for x in self.ledger.positions.values()],
                       "summary": self.ledger.summary(), "closed": p.to_dict(),
                       "stats": self.journal.stats()})
