import { Link } from "react-router-dom";
import { Avatar, Tag } from "../components/ui";
import { coin, fmtINRs, fmtLakh, fmtUSD, pct, pct0 } from "../format";
import { useFirm } from "../store";

const ROLES = [
  ["CEO", "You", "Chief Executive Officer", "Every trade waits for your call: long, short or stand down; hold, close or flip."],
  ["MD", "Managing Director", "Owns the P&L", "Pushes for size when the desk agrees. Says when the room is timid or reckless."],
  ["RISK", "Risk Manager", "Sizes and kills", "Sets size, leverage, stop and target. The rulebook clamps whatever it says."],
  ["COMPLIANCE", "Compliance", "Watches the limits", "Exposure caps, stale data, wide spreads, the drawdown halt. Immovable."],
  ["LEAD", "3 Desk Leads", "One per coin", "Spot the setup, call the room, open the argument."],
  ["QUANT", "3 Quants", "The indicator stack", "EMA, RSI, MACD, ATR. One of them enjoys taking the other side."],
  ["RESEARCH", "3 Researchers", "Regime and context", "Trending, ranging, volatile, exhausted. Flows and the day's story."],
  ["TRADER", "6 Traders", "Momentum and fills", "Can it be filled cleanly at this spread? Is the move already gone?"],
];

export function Landing() {
  const s = useFirm();
  const sum = s.summary;
  const f = s.firm;
  const st = s.stats;
  return (
    <div className="landing">
      <div className="lwrap">
        <nav className="lnav">
          <div className="brand">
            <div className="brand-mark">F</div>
            <div>
              <div className="brand-name">AI Trading Firm</div>
              <div className="brand-sub">paper desk · live prices</div>
            </div>
          </div>
          <div className="links">
            <a href="#how">How it works</a>
            <a href="#office">The office</a>
            <a href="#discipline">Discipline</a>
            <a href="https://github.com/bhatspranav7/AI-Trading-Firm" target="_blank" rel="noreferrer">Source</a>
            <Link to="/app" className="gold">Open the firm →</Link>
          </div>
        </nav>

        <section className="hero">
          <div>
            <div className="eyebrow">Multi-agent trading desk</div>
            <h1 className="h-title">
              Not a bot.<br />
              <em>A whole firm,</em><br />
              and you run it.
            </h1>
            <p className="h-sub">
              Twenty-five AI employees across three desks argue every trade in a boardroom. Risk sizes it, compliance
              clears it, the chief of staff recommends. Then the decision comes to you, the CEO, with a countdown.
              Live exchange prices, real spreads and fees, paper capital in rupees.
            </p>
            <div className="cta-row">
              <Link to="/app" className="btn primary lg">Enter the firm as CEO</Link>
              <a href="#how" className="btn ghost lg">See how a trade gets made</a>
            </div>
          </div>
          <div className="hero-card">
            <div className="row between">
              <h3>Live from the floor</h3>
              <Tag tone={s.connected ? "good" : "bad"}>{s.connected ? "streaming" : "offline"}</Tag>
            </div>
            {sum && f ? (
              <>
                <div className="row-k">
                  <div className="kpi"><div className="kpi-l">Equity</div><div className="kpi-v">{fmtLakh(sum.equity)}</div></div>
                  <div className="kpi"><div className="kpi-l">Session P&L</div><div className={`kpi-v ${sum.pnl >= 0 ? "good" : "bad"}`}>{fmtINRs(sum.pnl)}</div><div className="kpi-s">{pct(sum.pnl_pct)}</div></div>
                  <div className="kpi"><div className="kpi-l">Committed</div><div className="kpi-v">{pct0(sum.committed_pct, 0)}</div><div className="kpi-s">cap {(f.limits.max_committed * 100).toFixed(0)}%</div></div>
                  <div className="kpi"><div className="kpi-l">Staff</div><div className="kpi-v">{f.staff}</div><div className="kpi-s">of {f.max_staff} seats</div></div>
                </div>
                <div className="ticker">
                  {f.symbols.map((sym) => {
                    const m = s.markets[sym];
                    return (
                      <div className="tick" key={sym}>
                        <div className="l">{coin(sym)}</div>
                        <div className="v">{m?.ready ? fmtUSD(m.price) : "…"}</div>
                        {m?.ready && <div className={`small mono ${m.chg_60 >= 0 ? "good" : "bad"}`}>{pct(m.chg_60)} 1h</div>}
                      </div>
                    );
                  })}
                </div>
                {st && st.trades > 0 && (
                  <div className="small muted">
                    Journal: {st.trades} trades · win rate {pct0(st.win_rate, 0)} · profit factor {st.profit_factor.toFixed(2)} · {st.meetings} meetings
                  </div>
                )}
                {s.pending.length > 0 && (
                  <Link to={`/app/boardroom/${s.pending[0].id}`} className="btn primary block">
                    {s.pending.length} decision{s.pending.length > 1 ? "s" : ""} waiting for the CEO →
                  </Link>
                )}
              </>
            ) : (
              <div className="muted small">Connecting to the firm…</div>
            )}
          </div>
        </section>

        <section className="section" id="how">
          <h2 className="sec-h">How a trade gets made</h2>
          <p className="sec-p">Nothing trades on one opinion. A trade is the output of a disagreement that got resolved, under rules none of the participants can bend.</p>
          <div className="steps">
            <div className="step"><div className="step-n">01</div><h4>A desk lead calls the room</h4><p>The indicator bias crosses the setup threshold, a position needs review, or the scheduled check comes round. The other two desks keep working.</p></div>
            <div className="step"><div className="step-n">02</div><h4>The desk argues</h4><p>Lead, quant, researcher, a trader and the MD each give a typed opinion: stance, confidence, and what they say to the room. They see what colleagues said and push back by name.</p></div>
            <div className="step"><div className="step-n">03</div><h4>Risk sizes it, compliance checks it</h4><p>The risk manager proposes size, leverage, stop and target in ATR multiples. The rulebook clamps it: 30% committed, 15% per position, 1% at risk, fees must be covered three times.</p></div>
            <div className="step"><div className="step-n">04</div><h4>You decide</h4><p>The chief of staff recommends with a conviction score. The decision waits for you with a deadline. Take the recommendation, change the size, override risk, or stand down.</p></div>
          </div>
        </section>

        <section className="section" id="office">
          <h2 className="sec-h">Who works here</h2>
          <p className="sec-p">Nineteen at the open, hiring to twenty-five as trades close. Each has a personality and a risk appetite, and they do not agree with each other.</p>
          <div className="roles">
            {ROLES.map(([role, name, title, text]) => (
              <div className="role" key={role}>
                <Avatar name={name === "You" ? "You" : name} role={role} size={38} status={name === "You" ? "human" : undefined} />
                <div>
                  <h4>{name}</h4>
                  <div className="small gold" style={{ marginBottom: 4 }}>{title}</div>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="section" id="discipline">
          <h2 className="sec-h">Discipline, enforced in code</h2>
          <p className="sec-p">The agents can argue for anything. The ledger and the risk desk decide what actually happens.</p>
          <div className="rules">
            <div className="rule"><b>30% committed, 15% per position</b><span>Most capital sits idle by design. Bigger size might make more, or turn a good hour into a bad one.</span></div>
            <div className="rule"><b>1% of capital at risk per trade</b><span>Size is scaled down until the loss at the stop is at most one percent.</span></div>
            <div className="rule"><b>Fees covered three times</b><span>Stop and target widen until the target clears three round trips of fees. Scalps smaller than the fee are refused.</span></div>
            <div className="rule"><b>Conviction under 50% stands down</b><span>A split room does not get capital, however loud the loudest voice.</span></div>
            <div className="rule"><b>5% drawdown halts new entries</b><span>Compliance also blocks stale data and spreads too wide to fill cleanly.</span></div>
            <div className="rule"><b>Every meeting is journaled</b><span>Judge the firm over hundreds of trades, by desk, by exit reason, by who decided.</span></div>
          </div>
        </section>

        <section className="section">
          <h2 className="sec-h">Under the hood</h2>
          <p className="sec-p">Open source end to end. Runs on a laptop; deploys as one container.</p>
          <div className="stackrow">
            {["Python · FastAPI · WebSockets", "Binance / Bybit public market data", "Open-source LLMs · Ollama or Groq · typed JSON outputs", "SQLite journal", "React · TypeScript · Vite", "TradingView lightweight charts", "Docker"].map((t) => (
              <Tag key={t} tone="soft">{t}</Tag>
            ))}
          </div>
        </section>

        <footer className="lfoot">
          <div>Paper trading on live prices. No real money, no exchange keys. The model is disciplined, not prophetic.</div>
          <div><a href="https://github.com/bhatspranav7/AI-Trading-Firm" target="_blank" rel="noreferrer">github.com/bhatspranav7/AI-Trading-Firm</a></div>
        </footer>
      </div>
    </div>
  );
}
