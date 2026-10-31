import type { Agent, Market, Position, State } from "../types";
import { coin, fmtINRs, fmtUSD, initials, pct, pct0 } from "../format";

const ROLE_SHORT: Record<string, string> = {
  CEO: "CEO", MD: "MD", RISK: "Risk", COMPLIANCE: "Compliance",
  LEAD: "Lead", QUANT: "Quant", RESEARCH: "Research", TRADER: "Trader",
};

export function Avatar({ a, size = 30 }: { a: Pick<Agent, "name" | "role" | "status">; size?: number }) {
  return (
    <div className={`avatar r-${a.role.toLowerCase()} s-${a.status}`} style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials(a.name)}
    </div>
  );
}

function AgentChip({ a }: { a: Agent }) {
  const tip = `${a.name} · ${a.title}\n${a.personality}\nRisk appetite ${(a.risk_appetite * 100).toFixed(0)}%` +
    (a.last_statement ? `\n\nLast: "${a.last_statement}"` : "");
  return (
    <div className={`chip s-${a.status}`} title={tip}>
      <Avatar a={a} />
      <div className="chip-text">
        <div className="chip-name">{a.name}</div>
        <div className="chip-role">
          {ROLE_SHORT[a.role]}
          {a.status === "coffee" && <span className="tag coffee">☕ coffee</span>}
          {a.status === "arriving" && <span className="tag arriving">reception</span>}
          {a.status === "boardroom" && <span className="tag board">boardroom</span>}
          {a.status === "working" && a.last_stance && <span className={`tag st-${a.last_stance.toLowerCase()}`}>{a.last_stance}</span>}
        </div>
      </div>
    </div>
  );
}

function BiasBar({ score }: { score: number }) {
  const w = Math.min(50, Math.abs(score) * 50);
  return (
    <div className="bias" title={`indicator bias ${score.toFixed(2)}`}>
      <div className="bias-mid" />
      <div className={`bias-fill ${score >= 0 ? "pos" : "neg"}`} style={score >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
    </div>
  );
}

function Desk({ symbol, agents, market, position, onCall, busy, inMeeting }: {
  symbol: string; agents: Agent[]; market?: Market; position?: Position; onCall: () => void; busy: boolean; inMeeting: boolean;
}) {
  const m = market;
  return (
    <div className={`desk ${inMeeting ? "in-meeting" : ""}`}>
      <div className="desk-head">
        <div>
          <div className="desk-title">{coin(symbol)} desk</div>
          <div className="desk-sub">{agents.length} people{inMeeting ? " · in the boardroom" : ""}</div>
        </div>
        {m?.ready ? (
          <div className="desk-price">
            <div className="price">{fmtUSD(m.price)}</div>
            <div className={`chg ${m.chg_15 >= 0 ? "pos" : "neg"}`}>{pct(m.chg_15)} 15m · {pct(m.chg_60)} 1h</div>
          </div>
        ) : (
          <div className="desk-price muted">warming up{m ? ` (${(m as any).candles ?? ""})` : ""}</div>
        )}
      </div>
      {m?.ready && (
        <div className="desk-ind">
          <span>RSI <b>{m.rsi?.toFixed(0)}</b></span>
          <span>MACD <b className={(m.macd_hist ?? 0) >= 0 ? "pos" : "neg"}>{(m.macd_hist ?? 0) >= 0 ? "+" : "−"}{m.macd_rising ? "↑" : "↓"}</b></span>
          <span>ATR <b>{pct0(m.atr_pct)}</b></span>
          <span>spread <b>{m.spread_pct.toFixed(3)}%</b></span>
          <span className={`regime ${m.regime}`}>{m.regime}</span>
        </div>
      )}
      {m?.ready && <BiasBar score={m.score} />}
      <div className="chips">
        {agents.map((a) => <AgentChip key={a.id} a={a} />)}
      </div>
      <div className="desk-foot">
        {position ? (
          <div className={`pos-line ${position.side.toLowerCase()}`}>
            <b>{position.side}</b> {position.qty.toFixed(4)} @ {fmtUSD(position.entry)} · {position.leverage}x ·{" "}
            <span className={position.unrealized_inr >= 0 ? "pos" : "neg"}>{fmtINRs(position.unrealized_inr)} ({pct(position.unrealized_pct, 1)})</span>
            <div className="muted small">stop {fmtUSD(position.stop)} · target {fmtUSD(position.target)}</div>
          </div>
        ) : (
          <div className="muted small">flat</div>
        )}
        <button className="btn ghost" disabled={busy || inMeeting} onClick={onCall} title="Call this desk into the boardroom now">
          Call meeting
        </button>
      </div>
    </div>
  );
}

export function Office({ state, onCall, busy }: { state: State; onCall: (sym: string) => void; busy: boolean }) {
  const execs = state.agents.filter((a) => !a.desk);
  const live = state.meeting?.symbol ?? null;
  return (
    <>
      <div className="panel">
        <div className="panel-head"><h3>Executive floor</h3><span className="muted small">make the final call · own the P&L · size and kill · watch the limits</span></div>
        <div className="execs">
          {execs.map((a) => (
            <div key={a.id} className={`exec s-${a.status}`} title={`${a.personality}${a.last_statement ? `\n\nLast: "${a.last_statement}"` : ""}`}>
              <Avatar a={a} size={40} />
              <div>
                <div className="chip-name">{a.name}</div>
                <div className="chip-role">{a.title}</div>
                <div className="exec-status">{a.status === "boardroom" ? "in the boardroom" : a.status === "coffee" ? "coffee" : "at desk"}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h3>Trading floor</h3><span className="muted small">one desk per coin · while one desk is in the boardroom the others keep working</span></div>
        <div className="desks">
          {state.firm?.symbols.map((sym) => (
            <Desk
              key={sym}
              symbol={sym}
              agents={state.agents.filter((a) => a.desk === sym)}
              market={state.markets[sym]}
              position={state.positions.find((p) => p.symbol === sym)}
              onCall={() => onCall(sym)}
              busy={busy || !!live}
              inMeeting={live === sym}
            />
          ))}
        </div>
      </div>
      <div className="panel reception">
        <div className="panel-head"><h3>Reception & coffee</h3></div>
        <div className="chips">
          {state.agents.filter((a) => a.status === "coffee" || a.status === "arriving").map((a) => <AgentChip key={a.id} a={a} />)}
          {state.agents.every((a) => a.status !== "coffee" && a.status !== "arriving") && <div className="muted small">Empty. Everyone is at their desk.</div>}
        </div>
      </div>
    </>
  );
}
