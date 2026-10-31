import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DecisionDesk } from "../components/DecisionDesk";
import { MeetingTitle, Transcript } from "../components/Transcript";
import { Card, Countdown, Empty, Stance, Tag } from "../components/ui";
import { clock, coin, label } from "../format";
import { api, useFirm } from "../store";
import type { Meeting } from "../types";

export function BoardroomPage() {
  const s = useFirm();
  const { id } = useParams();
  const nav = useNavigate();
  const [history, setHistory] = useState<Meeting[]>([]);

  useEffect(() => {
    api<any[]>("/api/meetings?limit=40")
      .then((rows) =>
        setHistory(
          rows.map((r) => ({
            id: -r.id, symbol: r.symbol, trigger: r.trigger, started: r.ts, ended: r.ts, status: "done",
            transcript: r.transcript, decision: r.decision, conviction: r.conviction, executed: !!r.executed,
            outcome: "", snapshot: {}, attendees: [], decided_by: r.decided_by, position: null,
          })),
        ),
      )
      .catch(() => undefined);
  }, [s.meetings.length]);

  const all = useMemo(() => {
    const live = s.meeting ? [s.meeting] : [];
    const ids = new Set([...live, ...s.pending, ...s.meetings].map((m) => m.id));
    const sessionStarts = new Set(s.meetings.map((m) => Math.round(m.started)));
    const older = history.filter((h) => !sessionStarts.has(Math.round(h.started)));
    const list = [...live, ...s.pending, ...[...s.meetings].filter((m) => m.status === "done" && !s.pending.some((p) => p.id === m.id) && !live.some((l) => l.id === m.id)).reverse(), ...older];
    return list.filter((m, i) => list.findIndex((x) => x.id === m.id) === i && (ids.has(m.id) || m.id < 0));
  }, [s.meeting, s.pending, s.meetings, history]);

  const selected: Meeting | undefined = useMemo(() => {
    if (id) {
      const found = all.find((m) => String(m.id) === id);
      if (found) return found;
    }
    return s.pending[0] ?? s.meeting ?? all[0];
  }, [id, all, s.pending, s.meeting]);

  const isLive = selected?.status === "live";

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Boardroom</h1>
          <p>{s.pending.length ? `${s.pending.length} decision${s.pending.length > 1 ? "s" : ""} waiting for you.` : isLive ? "A desk is arguing a trade." : "Every meeting, every argument, every call."}</p>
        </div>
      </div>

      <div className="grid main-side">
        <div className="stack">
          {selected ? (
            <>
              {selected.status === "awaiting_ceo" && <DecisionDesk m={selected} />}
              <Card title={<MeetingTitle m={selected} />} aside={selected.status === "awaiting_ceo" && selected.deadline ? <>deadline <Countdown deadline={selected.deadline} /></> : selected.status === "done" ? <span>{selected.transcript.length} statements</span> : undefined}>
                <Transcript m={selected} live={isLive} scroll={false} />
              </Card>
            </>
          ) : (
            <Card><Empty title="No meetings yet." text="A desk lead calls the room when a setup appears. You can call one from Command or any desk." /></Card>
          )}
        </div>

        <Card title="Meetings" aside={<span>{all.length}</span>} pad={false}>
          {all.length === 0 ? (
            <div className="muted small" style={{ padding: 14 }}>Nothing yet.</div>
          ) : (
            <div>
              {all.map((m) => (
                <div key={m.id} className={`hist-row ${selected?.id === m.id ? "sel" : ""}`} onClick={() => nav(`/app/boardroom/${m.id}`)}>
                  <span className="muted xs mono">{clock(m.started)}</span>
                  <b>{coin(m.symbol)}</b>
                  <span className="muted small ellipsis">{m.trigger}</span>
                  {m.status === "live" ? <Tag tone="warn">live</Tag> : m.status === "awaiting_ceo" ? <Tag tone="gold">you</Tag> : <Stance s={m.decision} />}
                  <span className="muted xs">{m.conviction != null ? `${(m.conviction * 100).toFixed(0)}%` : ""}</span>
                  <span className="muted xs">{m.decided_by === "human" ? "your call" : m.decided_by === "timeout" ? "deadline" : m.decided_by ? label(m.decided_by) : ""}</span>
                  <span className="muted xs ellipsis">{m.outcome}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
