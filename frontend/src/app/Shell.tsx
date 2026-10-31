import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Btn, Countdown, KPI, PasscodeModal, Toasts, useAction } from "../components/ui";
import { ago, coin, fmtINRs, fmtLakh, label, pct, pct0 } from "../format";
import { api, useFirm } from "../store";

const NAV = [
  { to: "/app", end: true, ic: "◈", label: "Command" },
  { to: "/app/boardroom", ic: "◉", label: "Boardroom" },
  { to: "/app/desks", ic: "▤", label: "Desks" },
  { to: "/app/book", ic: "≣", label: "Book" },
  { to: "/app/people", ic: "☷", label: "People" },
  { to: "/app/journal", ic: "∿", label: "Journal" },
  { to: "/app/settings", ic: "⚙", label: "Settings" },
];

export function Shell() {
  const s = useFirm();
  const nav = useNavigate();
  const { busy, needKey, setNeedKey, run } = useAction();
  const [confirmKill, setConfirmKill] = useState(false);
  const f = s.firm;
  const sum = s.summary;

  if (!f || !sum) {
    return (
      <div className="landing" style={{ display: "grid", placeItems: "center" }}>
        <div className="empty">
          <div className="empty-t">{s.connected ? "Opening the office…" : "Connecting to the firm…"}</div>
          <div className="empty-x">The backend serves this page and streams state over a WebSocket. If this does not resolve, the firm is not running.</div>
        </div>
      </div>
    );
  }

  const cap = f.limits.max_committed * 100;
  const pendingCount = s.pending.length;
  const nextDeadline = s.pending.length ? Math.min(...s.pending.map((p) => p.deadline ?? Infinity)) : null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <div className="brand-mark">F</div>
          <div>
            <div className="brand-name">AI Trading Firm</div>
            <div className="brand-sub">{f.ceo_mode === "human" ? "You are CEO" : "Autopilot"}</div>
          </div>
        </NavLink>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
              <span className="nav-ic">{n.ic}</span>
              {n.label}
              {n.label === "Boardroom" && pendingCount > 0 && <span className="nav-badge">{pendingCount}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="status"><span className={`status-dot ${s.connected ? "good" : "bad"}`} />{s.connected ? "live stream" : "reconnecting"}</div>
          <div className="status"><span className={`status-dot ${f.market_source === "binance" ? "good" : "warn"}`} />{f.market_source === "binance" ? "Binance spot, live" : "simulated market"}</div>
          <div className="status" title={f.llm.error ?? ""}><span className={`status-dot ${f.llm.available ? "good" : "warn"}`} />{f.llm.model} {f.llm.available ? `· ${f.llm.avg_latency}s/call` : "· offline, heuristics"}</div>
          <div className="status"><span className="status-dot" />{f.staff}/{f.max_staff} staff · open {ago(f.started_at)}</div>
          {f.paused && <div className="status"><span className="status-dot bad" />paused</div>}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="kpis">
            <KPI label="Equity" value={fmtLakh(sum.equity)} sub={`of ${fmtLakh(sum.capital)} paper`} />
            <KPI label="P&L" value={fmtINRs(sum.pnl)} sub={pct(sum.pnl_pct)} tone={sum.pnl >= 0 ? "good" : "bad"} />
            <KPI label="Unrealized" value={fmtINRs(sum.unrealized)} sub={`${sum.open_positions} open`} tone={sum.unrealized >= 0 ? "good" : "bad"} />
            <KPI label="Committed" value={pct0(sum.committed_pct, 0)} sub={`cap ${cap.toFixed(0)}%`} tone={sum.committed_pct > cap * 0.8 ? "gold" : undefined} />
            {s.positions.slice(0, 3).map((p) => (
              <KPI key={p.id} label={`${coin(p.symbol)} ${p.side}`} value={fmtINRs(p.unrealized_inr)} sub={`${p.leverage}x · ${pct(p.unrealized_pct, 1)}`} tone={p.unrealized_inr >= 0 ? "good" : "bad"} />
            ))}
          </div>
          <div className="topbar-actions">
            {f.paused ? (
              <Btn tone="good" disabled={busy} onClick={() => run(() => api("/api/resume", "POST"))}>Resume trading</Btn>
            ) : confirmKill ? (
              <>
                <Btn tone="bad" disabled={busy} onClick={() => { setConfirmKill(false); run(() => api("/api/kill", "POST")); }}>Confirm: close all & pause</Btn>
                <Btn tone="ghost" onClick={() => setConfirmKill(false)}>Cancel</Btn>
              </>
            ) : (
              <Btn tone="bad" onClick={() => setConfirmKill(true)} title="Close every position at market and pause the firm">Kill switch</Btn>
            )}
          </div>
        </header>

        <main className="content">
          {pendingCount > 0 && (
            <div className="alert gold">
              <div className="grow">
                <b>{pendingCount === 1 ? "One desk is waiting on your call." : `${pendingCount} desks are waiting on your call.`}</b>{" "}
                <span className="dim">
                  {s.pending.map((p) => `${coin(p.symbol)}: ${p.recommendation?.by ?? "advisor"} recommends ${label(p.recommendation?.decision)}`).join(" · ")}
                </span>
              </div>
              {nextDeadline && isFinite(nextDeadline) && <div className="row small muted">default in <Countdown deadline={nextDeadline} /></div>}
              <Btn tone="primary" onClick={() => nav(`/app/boardroom/${s.pending[0].id}`)}>Decide now</Btn>
            </div>
          )}
          <Outlet />
        </main>
      </div>
      <Toasts />
      <PasscodeModal open={needKey} onClose={() => setNeedKey(false)} />
    </div>
  );
}
