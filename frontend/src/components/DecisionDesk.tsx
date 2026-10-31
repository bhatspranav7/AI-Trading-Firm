import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Meeting } from "../types";
import { coin, fmtINR, fmtUSD, label } from "../format";
import { api, useFirm } from "../store";
import { Avatar, Btn, Countdown, PasscodeModal, Tag, useAction } from "./ui";

const OPT_HELP: Record<string, string> = {
  LONG: "Buy at the ask with a stop and target",
  SHORT: "Sell at the bid with a stop and target",
  STAND_DOWN: "No trade. The desk goes back to work",
  HOLD: "Keep the position and its stop",
  CLOSE: "Exit at market now",
  FLIP: "Close and open the opposite side",
};

export function DecisionDesk({ m }: { m: Meeting }) {
  const s = useFirm();
  const nav = useNavigate();
  const { busy, error, needKey, setNeedKey, run } = useAction();
  const rec = m.recommendation;
  const sized = m.risk?.sized ?? null;
  const limits = s.firm?.limits;
  const capital = s.summary?.capital ?? 1;
  const maxSize = (limits?.max_per_position ?? 0.15) * 100;
  const maxLev = limits?.max_leverage ?? 5;

  const [choice, setChoice] = useState<string>(rec?.decision ?? m.options?.[0] ?? "STAND_DOWN");
  const [size, setSize] = useState<number>(sized ? +sized.size_pct.toFixed(1) : 5);
  const [lev, setLev] = useState<number>(sized?.leverage ?? 1);
  const [override, setOverride] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    setChoice(rec?.decision ?? m.options?.[0] ?? "STAND_DOWN");
    setSize(sized ? +sized.size_pct.toFixed(1) : 5);
    setLev(sized?.leverage ?? 1);
    setOverride(false);
    setNote("");
  }, [m.id]);

  const entering = ["LONG", "SHORT", "FLIP"].includes(choice);
  const riskOk = !!m.risk?.approve;
  const compOk = m.compliance?.ok !== false;
  const blocked = entering && !riskOk && !override;

  const preview = useMemo(() => {
    const margin = (capital * size) / 100;
    const notional = margin * lev;
    let risk = sized ? sized.risk_inr * (size / (sized.size_pct || 1)) * (lev / (sized.leverage || 1)) : null;
    const cap = capital * (limits?.max_loss_per_trade ?? 0.01);
    const capped = risk != null && risk > cap;
    if (capped) risk = cap;
    return { margin, notional, risk, capped };
  }, [capital, size, lev, sized, limits]);

  const submit = async () => {
    const ok = await run(() =>
      api(`/api/decide/${m.id}`, "POST", {
        decision: choice,
        size_pct: entering ? size : undefined,
        leverage: entering ? lev : undefined,
        override_risk: entering && override,
        note,
      }),
    );
    if (ok) nav(`/app/boardroom/${m.id}`);
  };

  return (
    <div className="card gold">
      <header className="card-h">
        <div className="row gap">
          <h3>Your call · {coin(m.symbol)} desk</h3>
          <Tag tone="gold">{m.trigger}</Tag>
        </div>
        <div className="card-aside">
          {m.deadline && (
            <>
              default <b className="dim">{s.settings?.decision_timeout_action === "follow_advisor" ? "follows the advisor" : m.position ? "HOLD" : "STAND DOWN"}</b> in <Countdown deadline={m.deadline} />
            </>
          )}
        </div>
      </header>
      <div className="decision">
        <div className="left stack">
          {rec && (
            <div className="rec">
              <Avatar name={rec.by} role="CEO" status="boardroom" size={38} />
              <div className="grow">
                <div className="rec-t">{rec.by}, Chief of Staff, recommends <b className="gold">{label(rec.decision)}</b> at {(rec.conviction * 100).toFixed(0)}% conviction</div>
                <div className="rec-q">“{rec.statement}”</div>
              </div>
            </div>
          )}
          <div className="verdict-row">
            <div className="verdict-cell">
              <div className="l">Room</div>
              <div className="v">
                {m.consensus?.side ? <>{label(m.consensus.side)} <span className="muted">{((m.consensus.strength ?? 0) * 100).toFixed(0)}%</span></> : <span className="muted">split</span>}
              </div>
            </div>
            <div className="verdict-cell">
              <div className="l">Risk desk</div>
              <div className="v">
                <Tag tone={riskOk ? "good" : "bad"}>{riskOk ? "approved" : "rejected"}</Tag>
                {sized && <span className="muted small">{sized.size_pct.toFixed(1)}% · {sized.leverage}x</span>}
              </div>
            </div>
            <div className="verdict-cell">
              <div className="l">Compliance</div>
              <div className="v"><Tag tone={compOk ? "good" : "bad"}>{compOk ? "cleared" : "blocked"}</Tag></div>
            </div>
          </div>
          {m.risk?.notes && m.risk.notes.length > 0 && <ul className="notes">{m.risk.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          {!compOk && <div className="small bad">Compliance: {m.compliance?.notes.join("; ")}. New exposure will be refused.</div>}
          {m.position && (
            <div className="small dim">
              Holding <b>{m.position.side}</b> {m.position.qty.toFixed(4)} {coin(m.symbol)} from {fmtUSD(m.position.entry)} · stop {fmtUSD(m.position.stop)} · target {fmtUSD(m.position.target)}
            </div>
          )}
          <div className="opts">
            {(m.options ?? []).map((o) => (
              <button key={o} className={`opt ${o.toLowerCase()} ${choice === o ? "sel" : ""} ${rec?.decision === o ? "rec" : ""}`} onClick={() => setChoice(o)}>
                <span className="opt-l">{label(o)}</span>
                <span className="opt-s">{OPT_HELP[o]}</span>
                {rec?.decision === o && <Tag tone="gold">recommended</Tag>}
              </button>
            ))}
          </div>
        </div>

        <div className="stack">
          <h3>Sizing</h3>
          {entering ? (
            <>
              <div className="sizing">
                <div className="field">
                  <label><span>Size · % of capital</span><span className="mono">{size.toFixed(1)}%</span></label>
                  <input type="range" min={2} max={maxSize} step={0.5} value={size} onChange={(e) => setSize(+e.target.value)} />
                  <div className="hint">cap {maxSize.toFixed(0)}% per position · {((limits?.max_committed ?? 0.3) * 100).toFixed(0)}% across the firm</div>
                </div>
                <div className="field">
                  <label><span>Leverage</span><span className="mono">{lev}x</span></label>
                  <input type="range" min={1} max={maxLev} step={1} value={lev} onChange={(e) => setLev(+e.target.value)} />
                  <div className="hint">max {maxLev}x</div>
                </div>
              </div>
              <div className="sizing-out">
                <div className="cell"><div className="l">Margin</div><div className="v">{fmtINR(preview.margin)}</div></div>
                <div className="cell"><div className="l">Notional</div><div className="v">{fmtINR(preview.notional)}</div></div>
                <div className="cell"><div className="l">Risk at stop</div><div className="v">{preview.risk != null ? fmtINR(preview.risk) : "–"}{preview.capped && <span className="muted xs"> (1% cap)</span>}</div></div>
              </div>
              {sized && (
                <div className="small muted">
                  Stop {fmtUSD(sized.stop)} · target {fmtUSD(sized.target)} · R:R {sized.rr.toFixed(1)}. The risk desk recomputes stop, target and the 1% cap on your size when you execute.
                </div>
              )}
              {!riskOk && (
                <label className="check">
                  <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                  Override the risk desk. It is logged. You own it.
                </label>
              )}
            </>
          ) : (
            <div className="muted small">{OPT_HELP[choice]}. No sizing needed.</div>
          )}
          <div className="field">
            <label><span>Note for the record</span></label>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why you are making this call (optional)" />
          </div>
          {error && <div className="form-err">{error}</div>}
          <Btn tone="primary" size="lg block" disabled={busy || blocked} onClick={submit}>
            {blocked ? "Risk rejected this. Override or pick another option." : `Execute ${label(choice)}`}
          </Btn>
        </div>
      </div>
      <PasscodeModal open={needKey} onClose={() => setNeedKey(false)} />
    </div>
  );
}
