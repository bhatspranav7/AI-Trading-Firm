import { useEffect, useRef } from "react";
import type { Entry, Meeting } from "../types";
import { ago, clock, coin, fmtINR, fmtUSD, label } from "../format";
import { Avatar, Stance, Tag } from "./ui";

export function Line({ e }: { e: Entry }) {
  const role = e.role.toLowerCase();
  const isRisk = e.role === "RISK";
  const isComp = e.role === "COMPLIANCE";
  const isHuman = e.source === "human" || e.source === "timeout";
  const isCEO = e.role === "CEO" && !!e.decision;
  return (
    <div className={`msg ${role} ${isHuman ? "human" : ""}`}>
      <Avatar name={e.name} role={e.role} status={isHuman ? "human" : "boardroom"} size={34} />
      <div className="msg-body">
        <div className="msg-h">
          <b>{e.name}</b>
          <span className="muted">{e.title}</span>
          {isRisk && <Tag tone={e.approve ? "good" : "bad"}>{e.approve ? "approved" : "rejected"}</Tag>}
          {isComp && <Tag tone={e.approve ? "good" : "bad"}>{e.approve ? "cleared" : "blocked"}</Tag>}
          {isCEO && e.recommendation && <Tag tone="gold">recommends</Tag>}
          {isCEO && !e.recommendation && !isHuman && <Tag tone="gold">decision</Tag>}
          {isHuman && <Tag tone="gold">{e.source === "human" ? "your call" : "deadline"}</Tag>}
          {e.override && <Tag tone="bad">risk overridden</Tag>}
          {!isRisk && !isComp && <Stance s={e.stance} />}
          {!isComp && !isHuman && (
            <span className="conf" title={`${isCEO ? "conviction" : "confidence"} ${(e.confidence * 100).toFixed(0)}%`}>
              <i style={{ width: `${e.confidence * 100}%` }} />
            </span>
          )}
          {e.size_pct != null && <Tag>wants {e.size_pct.toFixed(0)}%</Tag>}
          <span className={`src ${e.source}`}>{e.source}</span>
          <span className="muted xs">{clock(e.ts)}</span>
        </div>
        <div className={`msg-t ${isCEO || isHuman ? "serif" : ""}`}>“{e.statement}”</div>
        {isRisk && e.sized && (
          <div className="sized">
            size {e.sized.size_pct.toFixed(1)}% · {e.sized.leverage}x · margin {fmtINR(e.sized.margin_inr)} · stop {fmtUSD(e.sized.stop)} · target {fmtUSD(e.sized.target)} · risk {fmtINR(e.sized.risk_inr)} · R:R {e.sized.rr.toFixed(1)}
          </div>
        )}
        {isRisk && e.notes && e.notes.length > 0 && <ul className="notes">{e.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      </div>
    </div>
  );
}

export function Transcript({ m, live, scroll = true }: { m: Meeting; live?: boolean; scroll?: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [m.transcript.length, live]);
  return (
    <div className={`transcript ${scroll ? "scroll" : ""}`}>
      {m.transcript.map((e, i) => <Line key={`${e.ts}-${e.agent_id}-${i}`} e={e} />)}
      {live && <div className="typing"><i /><i /><i /> the room is thinking…</div>}
      {m.status === "done" && m.outcome && (
        <div className={`outcome ${m.executed ? "executed" : ""}`}>
          <b>{m.executed ? "Executed" : "No trade"}</b> · {m.outcome}
          {m.decided_by && <span className="muted"> · decided by {m.decided_by === "human" ? "you" : m.decided_by === "timeout" ? "the deadline" : m.decided_by}</span>}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

export function MeetingTitle({ m }: { m: Meeting }) {
  const snap = m.snapshot;
  return (
    <div>
      <div className="row gap">
        <span className="desk-name">{coin(m.symbol)} desk</span>
        <Tag tone="soft">{m.trigger}</Tag>
        {m.status === "live" && <Tag tone="warn">in session</Tag>}
        {m.status === "awaiting_ceo" && <Tag tone="gold">waiting on you</Tag>}
        {m.status === "done" && m.decision && <Stance s={m.decision} />}
      </div>
      <div className="muted small" style={{ marginTop: 3 }}>
        {m.status === "done" ? `ended ${ago(m.ended ?? m.started)} ago` : `started ${ago(m.started)} ago`}
        {snap?.price != null && <> · {fmtUSD(snap.price)} · RSI {snap.rsi?.toFixed(0)} · {snap.regime} · bias {(snap.score ?? 0).toFixed(2)}</>}
        {m.decided_by && <> · {m.decided_by === "human" ? "your call" : m.decided_by === "timeout" ? "deadline default" : `${label(m.decided_by)} decided`}</>}
      </div>
    </div>
  );
}
