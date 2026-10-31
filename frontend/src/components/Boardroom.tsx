import { useEffect, useRef } from "react";
import type { Entry, Meeting, State } from "../types";
import { ago, clock, coin, fmtINR, fmtUSD } from "../format";
import { Avatar } from "./Office";

function Stance({ s }: { s: string }) {
  return <span className={`stance st-${s.toLowerCase()}`}>{s.replace("_", " ")}</span>;
}

function Line({ e }: { e: Entry }) {
  const isDecision = e.role === "CEO" && !!e.decision;
  const isRisk = e.role === "RISK";
  const isComp = e.role === "COMPLIANCE";
  return (
    <div className={`line r-${e.role.toLowerCase()} ${isDecision ? "decision" : ""}`}>
      <Avatar a={{ name: e.name, role: e.role, status: "boardroom" }} size={34} />
      <div className="line-body">
        <div className="line-head">
          <b>{e.name}</b>
          <span className="muted">{e.title}</span>
          {isRisk && <span className={`tag ${e.approve ? "ok" : "bad"}`}>{e.approve ? "APPROVED" : "REJECTED"}</span>}
          {isComp && <span className={`tag ${e.approve ? "ok" : "bad"}`}>{e.approve ? "CLEARED" : "BLOCKED"}</span>}
          {!isRisk && !isComp && <Stance s={e.stance} />}
          {!isComp && (
            <span className="conf" title={`${isDecision ? "conviction" : "confidence"} ${(e.confidence * 100).toFixed(0)}%`}>
              <span className="conf-fill" style={{ width: `${e.confidence * 100}%` }} />
            </span>
          )}
          {e.size_pct != null && <span className="tag">wants {e.size_pct.toFixed(0)}%</span>}
          <span className={`src ${e.source}`}>{e.source}</span>
          <span className="muted small">{clock(e.ts)}</span>
        </div>
        <div className="line-text">“{e.statement}”</div>
        {isRisk && e.sized && (
          <div className="sized">
            size {e.sized.size_pct.toFixed(1)}% · {e.sized.leverage}x · margin {fmtINR(e.sized.margin_inr)} · stop {fmtUSD(e.sized.stop)} · target {fmtUSD(e.sized.target)} · risk {fmtINR(e.sized.risk_inr)} · R:R {e.sized.rr.toFixed(1)}
          </div>
        )}
        {isRisk && e.notes && e.notes.length > 0 && (
          <ul className="notes">{e.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        )}
      </div>
    </div>
  );
}

function MeetingView({ m, live }: { m: Meeting; live: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [m.transcript.length, live]);
  const snap = m.snapshot;
  return (
    <>
      <div className="board-head">
        <div>
          <div className="board-title">
            <span className={`dot ${live ? "live" : ""}`} /> {coin(m.symbol)} desk · {m.trigger}
          </div>
          <div className="muted small">
            {live ? `in session · ${ago(m.started)}` : `ended ${ago(m.ended ?? m.started)} ago`}
            {snap?.price != null && <> · {fmtUSD(snap.price)} · RSI {snap.rsi?.toFixed(0)} · {snap.regime} · bias {(snap.score ?? 0).toFixed(2)}</>}
          </div>
        </div>
        {m.decision && (
          <div className={`verdict st-${m.decision.toLowerCase()}`}>
            <div className="verdict-d">{m.decision.replace("_", " ")}</div>
            <div className="verdict-c">{((m.conviction ?? 0) * 100).toFixed(0)}% conviction</div>
          </div>
        )}
      </div>
      <div className="transcript">
        {m.transcript.map((e, i) => <Line key={`${e.ts}-${e.agent_id}-${i}`} e={e} />)}
        {live && (
          <div className="typing"><span /><span /><span /> the room is thinking…</div>
        )}
        {!live && m.outcome && (
          <div className={`outcome ${m.executed ? "executed" : ""}`}>
            <b>{m.executed ? "Executed" : "No trade"}</b> · {m.outcome}
          </div>
        )}
        <div ref={endRef} />
      </div>
    </>
  );
}

export function Boardroom({ state }: { state: State }) {
  const live = state.meeting;
  const last = state.meetings[state.meetings.length - 1];
  return (
    <div className="panel board">
      <div className="panel-head">
        <h3>Boardroom</h3>
        <span className="muted small">
          {live ? "a desk is arguing a trade" : last ? "empty · showing the last meeting" : "empty"}
        </span>
      </div>
      {live ? (
        <MeetingView m={live} live />
      ) : last ? (
        <MeetingView m={last} live={false} />
      ) : (
        <div className="empty">
          <div className="muted">No meeting yet.</div>
          <div className="muted small">A desk lead calls the room when the indicator stack lines up, when a position needs review, or on the scheduled cadence. You can also call one from any desk.</div>
        </div>
      )}
      {state.meetings.length > 1 && (
        <div className="history">
          {[...state.meetings].reverse().slice(live ? 0 : 1, 7).map((m) => (
            <div key={m.id} className="hist-row">
              <span className="muted small">{clock(m.started)}</span>
              <b>{coin(m.symbol)}</b>
              <span className="muted small">{m.trigger}</span>
              <Stance s={m.decision ?? "–"} />
              <span className="muted small">{((m.conviction ?? 0) * 100).toFixed(0)}%</span>
              <span className="muted small hist-out">{m.outcome}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
