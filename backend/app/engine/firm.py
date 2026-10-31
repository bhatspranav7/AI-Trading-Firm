"""The office: roster, roles, personalities, hiring, and the little human touches."""
from __future__ import annotations

import random
import time
from dataclasses import asdict, dataclass, field

ROLE_TITLES = {
    "CEO": "Chief Executive Officer",
    "MD": "Managing Director",
    "RISK": "Risk Manager",
    "COMPLIANCE": "Compliance Officer",
    "LEAD": "Desk Lead",
    "QUANT": "Quant Analyst",
    "RESEARCH": "Research Analyst",
    "TRADER": "Execution Trader",
}

EXECS = [
    ("CEO", "Arjun Mehta", "Calm, decisive, hates trading a split room. Would rather miss a move than force one.", 0.45, 0.4),
    ("MD", "Priya Raman", "Owns the P&L and says so. Pushes for size when the desk agrees, mocks timid sizing.", 0.8, 0.7),
    ("RISK", "Daniel Okafor", "Stingy with risk budget. Has seen three blow-ups and talks about them. Cuts size first, asks later.", 0.2, 0.5),
    ("COMPLIANCE", "Meera Iyer", "Quiet until a limit is close, then immovable. Reads the rulebook aloud.", 0.1, 0.3),
]

DESK_STAFF = {
    "BTCUSDT": [
        ("LEAD", "Rohan Kapoor", "Patient trend follower. Calls meetings only when the stack lines up.", 0.5, 0.6),
        ("QUANT", "Elena Volkova", "Contrarian by habit; enjoys taking the other side of the room when RSI is stretched.", 0.6, 0.9),
        ("RESEARCH", "Kabir Shah", "Thinks in regimes: trending, ranging, exhausted. Distrusts breakouts on thin volume.", 0.4, 0.6),
        ("TRADER", "Sam Reyes", "Momentum trader. Wants to be in early and out fast. Impatient with research.", 0.75, 0.8),
        ("TRADER", "Ananya Rao", "Spread and fills obsessive. Cares whether the trade can actually be executed cleanly.", 0.4, 0.6),
    ],
    "ETHUSDT": [
        ("LEAD", "Zoe Tanaka", "Direct, runs tight meetings, wants a plan with a stop before anyone speaks.", 0.55, 0.6),
        ("QUANT", "Vikram Nair", "MACD purist. Will not go against histogram direction, whatever the story is.", 0.5, 0.6),
        ("RESEARCH", "Lucas Brandt", "Reads flows and the day's narrative. Skeptical of indicator-only calls.", 0.45, 0.7),
        ("TRADER", "Fatima Al-Sayed", "Scalper mindset. Loves volatility, hates sitting in a trade.", 0.8, 0.8),
        ("TRADER", "Nikhil Verma", "Careful executor. Argues for smaller size and wider stops.", 0.3, 0.5),
    ],
    "SOLUSDT": [
        ("LEAD", "Marcus Chen", "Aggressive lead. Believes SOL rewards conviction and punishes hesitation.", 0.7, 0.7),
        ("QUANT", "Ishaan Gupta", "Mean-reversion quant. Sees every extreme as a fade.", 0.55, 0.8),
        ("RESEARCH", "Sofia Moreau", "Macro-aware. Links the coin's move to BTC's and to the broader regime.", 0.4, 0.6),
        ("TRADER", "Dev Patel", "Breakout trader. Chases strength, cuts quickly.", 0.75, 0.8),
        ("TRADER", "Hana Kim", "Risk-aware trader. Asks what the stop costs before she asks about the target.", 0.35, 0.5),
    ],
}

HIRE_POOL = [
    ("TRADER", "Omar Haddad", "Hired from a prop desk. Fast hands, short memory.", 0.7, 0.8),
    ("RESEARCH", "Lin Wei", "Former macro analyst. Puts every move in context.", 0.4, 0.6),
    ("QUANT", "Aditi Menon", "Volatility quant. Sizes by ATR before she looks at direction.", 0.5, 0.6),
    ("TRADER", "Jonas Keller", "Patient executor. Likes limit fills and boring trades.", 0.35, 0.5),
    ("RESEARCH", "Tariq Bello", "Flow watcher. Thinks volume ratio tells the real story.", 0.45, 0.7),
    ("QUANT", "Yuki Sato", "Trend quant. Only trades with the EMA stack.", 0.55, 0.6),
    ("TRADER", "Grace Oduya", "Momentum trader with a stubborn streak.", 0.7, 0.8),
    ("TRADER", "Pavel Novak", "Spread hawk. Rejects anything that cannot fill cleanly.", 0.4, 0.5),
]


@dataclass
class Agent:
    id: str
    name: str
    role: str
    desk: str | None
    personality: str
    risk_appetite: float
    temperature: float
    status: str = "working"           # working | boardroom | coffee | arriving
    status_until: float = 0.0
    last_statement: str = ""
    last_stance: str = ""
    meetings: int = 0
    calls: int = 0
    hired_at: float = field(default_factory=time.time)
    title_override: str | None = None

    @property
    def title(self) -> str:
        return self.title_override or ROLE_TITLES[self.role]

    def appetite_word(self) -> str:
        if self.risk_appetite >= 0.7:
            return "aggressive"
        if self.risk_appetite >= 0.45:
            return "balanced"
        return "conservative"

    def to_dict(self) -> dict:
        d = asdict(self)
        d["title"] = self.title
        return d


class Firm:
    def __init__(self, symbols: list[str], max_staff: int, hire_every: int, coffee_chance: float,
                 human_ceo: bool = True):
        self.symbols = symbols
        self.max_staff = max_staff
        self.hire_every = hire_every
        self.coffee_chance = coffee_chance
        self.agents: list[Agent] = []
        self.hire_pool = list(HIRE_POOL)
        self.trades_seen = 0
        self.opened_at = time.time()
        self._n = 0
        for role, name, pers, app, temp in EXECS:
            self._add(role, name, None, pers, app, temp)
        for sym in symbols:
            staff = DESK_STAFF.get(sym) or self._generic_desk(sym)
            for role, name, pers, app, temp in staff:
                self._add(role, name, sym, pers, app, temp)
        self.set_human_ceo(human_ceo)

    def set_human_ceo(self, human: bool) -> None:
        """With a human CEO, the AI chief executive becomes Chief of Staff and only recommends."""
        a = self.exec("CEO")
        a.title_override = "Chief of Staff" if human else None
        self.human_ceo = human

    @staticmethod
    def _generic_desk(sym: str):
        tag = sym[:3]
        return [
            ("LEAD", f"{tag} Lead", "Steady desk lead.", 0.5, 0.6),
            ("QUANT", f"{tag} Quant", "Indicator-driven quant.", 0.5, 0.7),
            ("RESEARCH", f"{tag} Research", "Regime-aware researcher.", 0.45, 0.6),
            ("TRADER", f"{tag} Trader A", "Momentum trader.", 0.7, 0.8),
            ("TRADER", f"{tag} Trader B", "Fills-focused trader.", 0.4, 0.6),
        ]

    def _add(self, role, name, desk, pers, app, temp, arriving=False) -> Agent:
        self._n += 1
        a = Agent(id=f"a{self._n:02d}", name=name, role=role, desk=desk, personality=pers,
                  risk_appetite=app, temperature=temp)
        if arriving:
            a.status = "arriving"
            a.status_until = time.time() + 25
        self.agents.append(a)
        return a

    # ---------------------------------------------------------------- lookup
    def exec(self, role: str) -> Agent:
        return next(a for a in self.agents if a.role == role and a.desk is None)

    def desk(self, symbol: str) -> list[Agent]:
        return [a for a in self.agents if a.desk == symbol]

    def desk_role(self, symbol: str, role: str) -> list[Agent]:
        return [a for a in self.desk(symbol) if a.role == role and a.status != "arriving"]

    def by_id(self, aid: str) -> Agent | None:
        return next((a for a in self.agents if a.id == aid), None)

    # --------------------------------------------------------------- dynamics
    @staticmethod
    def set_status(agents: list[Agent], status: str, seconds: float = 0):
        for a in agents:
            a.status = status
            a.status_until = time.time() + seconds if seconds else 0.0

    def tick(self) -> list[str]:
        """Advance coffee breaks and arrivals. Returns human-readable events."""
        now = time.time()
        events = []
        for a in self.agents:
            if a.status in ("coffee", "arriving") and now >= a.status_until:
                if a.status == "arriving":
                    events.append(f"{a.name} walked in through reception and joined the "
                                  f"{(a.desk or '')[:3]} desk as {a.title}")
                a.status = "working"
            elif a.status == "working" and a.desk and random.random() < self.coffee_chance:
                a.status = "coffee"
                a.status_until = now + random.uniform(40, 90)
                events.append(f"{a.name} stepped out for coffee")
        return events

    def on_trade_closed(self, symbol: str) -> Agent | None:
        """Every few closed trades the firm hires, if it still has room and candidates."""
        self.trades_seen += 1
        if len(self.agents) >= self.max_staff or not self.hire_pool:
            return None
        if self.trades_seen % self.hire_every != 0:
            return None
        role, name, pers, app, temp = self.hire_pool.pop(0)
        return self._add(role, name, symbol, pers, app, temp, arriving=True)

    def to_list(self) -> list[dict]:
        return [a.to_dict() for a in self.agents]
