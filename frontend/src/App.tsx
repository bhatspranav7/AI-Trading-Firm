import { useState } from "react";
import { Boardroom } from "./components/Boardroom";
import { Office } from "./components/Office";
import { EquityChart, EventFeed, Positions, StatsPanel, TradeLog } from "./components/Panels";
import { ago, fmtINR, fmtINRs, pct, pct0 } from "./format";
import { post, useFirm } from "./useFirm";

export default function App() {
  const s = useFirm();
  const [busy, setBusy] = useState(false);
  const f = s.firm;
  const sum = s.summary;

  const act = async (path: string) => {
    setBusy(true);
    try {
      await post(path);
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!f || !sum) {
    return (
      <div className="boot">
        <div className="boot-card">
          <div className="logo">AI Trading Firm</div>
          <div className="muted">{s.connected ? "Loading the office…" : "Connecting to the firm…"}</div>
        </div>
      </div>
    );
  }

  const cap = f.limits.max_committed * 100;
  const pnlClass = sum.pnl >= 0 ? "pos" : "neg";

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <div className="logo">AI Trading Firm</div>
          <div className="pills">
            <span className={`pill ${s.connected ? "ok" : "bad"}`}>{s.connected ? "live" : "reconnecting"}</span>
            <span className={`pill ${f.market_source === "binance" ? "ok" : "warn"}`}>
              market · {f.market_source === "binance" ? "Binance live" : "simulation"}
            </span>
            <span className={`pill ${f.llm.available ? "ok" : "warn"}`} title={f.llm.error ?? ""}>
              agents · {f.llm.model} {f.llm.available ? `· ${f.llm.avg_latency}s` : "offline → heuristics"}
            </span>
            <span className="pill">staff {f.staff}/{f.max_staff}</span>
            <span className="pill">open {ago(f.started_at)}</span>
            {f.paused && <span className="pill bad">PAUSED</span>}
          </div>
        </div>
        <div className="strip">
          <Stat label="Equity" value={fmtINR(sum.equity)} sub={`of ${fmtINR(sum.capital)} paper`} />
          <Stat label="P&L" value={fmtINRs(sum.pnl)} sub={pct(sum.pnl_pct)} cls={pnlClass} />
          <Stat label="Realized" value={fmtINRs(sum.realized)} sub={`fees ${fmtINR(sum.fees)}`} cls={sum.realized >= 0 ? "pos" : "neg"} />
          <Stat label="Unrealized" value={fmtINRs(sum.unrealized)} sub={`${sum.open_positions} open`} cls={sum.unrealized >= 0 ? "pos" : "neg"} />
          <div className="stat">
            <div className="label">Committed</div>
            <div className="value">{pct0(sum.committed_pct, 0)}</div>
            <div className="bar">
              <div className="fill" style={{ width: `${Math.min(100, (sum.committed_pct / cap) * 100)}%` }} />
            </div>
            <div className="sub">cap {cap.toFixed(0)}% · {fmtINR(sum.committed)}</div>
          </div>
          <div className="controls">
            {f.paused ? (
              <button className="btn ok" disabled={busy} onClick={() => act("/api/resume")}>Resume</button>
            ) : (
              <button className="btn danger" disabled={busy} onClick={() => confirm("Close every position and pause the firm?") && act("/api/kill")}>
                Kill switch
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="grid">
        <section className="col office-col">
          <Office state={s} onCall={(sym) => act(`/api/meeting/${sym}`)} busy={busy} />
        </section>
        <section className="col board-col">
          <Boardroom state={s} />
        </section>
        <section className="col side-col">
          <Positions positions={s.positions} markets={s.markets} />
          <EquityChart points={s.equity} capital={sum.capital} />
          <StatsPanel stats={s.stats} />
          <EventFeed events={s.events} />
        </section>
      </main>

      <TradeLog closed={s.closed} />

      <footer className="foot">
        Paper trading on live prices. No real money. Decisions are made by open-source models running locally; they are disciplined, not prophetic.
      </footer>
    </div>
  );
}

function Stat({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value ${cls ?? ""}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
