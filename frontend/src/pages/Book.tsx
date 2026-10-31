import { useEffect, useState } from "react";
import { Btn, Card, PasscodeModal, Stance, Tag, useAction } from "../components/ui";
import { clock, coin, dateTime, dur, fmtINR, fmtINRs, fmtUSD, pct } from "../format";
import { api, useFirm } from "../store";

export function Book() {
  const s = useFirm();
  const { busy, error, needKey, setNeedKey, run } = useAction();
  const [history, setHistory] = useState<any[]>([]);
  useEffect(() => {
    api<any[]>("/api/trades?limit=200").then(setHistory).catch(() => undefined);
  }, [s.closed.length]);

  const session = [...s.closed].reverse();
  const sessionIds = new Set(session.map((p) => p.id));
  const older = history.filter((t) => !sessionIds.has(t.id));

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Book</h1>
          <p>Open risk, this session's closed trades, and the full journal across runs.</p>
        </div>
        <a className="btn ghost" href="/api/trades.csv">Export journal CSV</a>
      </div>

      <Card title="Open positions" aside={<span>{s.positions.length} running · committed {fmtINR(s.summary?.committed)}</span>} pad={false}>
        {s.positions.length === 0 ? (
          <div className="muted small" style={{ padding: 14 }}>Flat across all desks.</div>
        ) : (
          <table className="table">
            <thead><tr><th>Desk</th><th>Side</th><th>Qty</th><th>Entry</th><th>Mark</th><th>Stop</th><th>Target</th><th>Lev</th><th>Margin</th><th>Notional</th><th>Unrealized</th><th>Opened</th><th></th></tr></thead>
            <tbody>
              {s.positions.map((p) => (
                <tr key={p.id}>
                  <td><b>{coin(p.symbol)}</b></td>
                  <td><Stance s={p.side} /></td>
                  <td className="num">{p.qty.toFixed(4)}</td>
                  <td className="num">{fmtUSD(p.entry)}</td>
                  <td className="num">{fmtUSD(p.mark)}</td>
                  <td className="num bad">{fmtUSD(p.stop)}</td>
                  <td className="num good">{fmtUSD(p.target)}</td>
                  <td className="num">{p.leverage}x</td>
                  <td className="num">{fmtINR(p.margin_inr)}</td>
                  <td className="num">{fmtINR(p.notional_inr)}</td>
                  <td className={`num ${p.unrealized_inr >= 0 ? "good" : "bad"}`}>{fmtINRs(p.unrealized_inr)} <span className="muted xs">{pct(p.unrealized_pct, 1)}</span></td>
                  <td className="muted small">{clock(p.opened_at)}</td>
                  <td><Btn tone="bad" size="sm" disabled={busy} onClick={() => run(() => api(`/api/positions/${p.symbol}/close`, "POST"))}>Close</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {error && <div className="form-err" style={{ padding: 12 }}>{error}</div>}
      </Card>

      <Card title="Closed this session" aside={<span>{session.length} trades · realized {fmtINRs(s.summary?.realized)} · fees {fmtINR(s.summary?.fees)}</span>} pad={false}>
        {session.length === 0 ? (
          <div className="muted small" style={{ padding: 14 }}>Nothing closed yet this session.</div>
        ) : (
          <table className="table">
            <thead><tr><th>Closed</th><th>Desk</th><th>Side</th><th>Entry → Exit</th><th>Lev</th><th>Margin</th><th>Held</th><th>Exit via</th><th>Fees</th><th>P&L</th><th>Rationale</th></tr></thead>
            <tbody>
              {session.map((p) => (
                <tr key={p.id}>
                  <td className="muted small">{clock(p.closed_at ?? p.opened_at)}</td>
                  <td><b>{coin(p.symbol)}</b></td>
                  <td><Stance s={p.side} /></td>
                  <td className="num">{fmtUSD(p.entry)} → {fmtUSD(p.exit)}</td>
                  <td className="num">{p.leverage}x</td>
                  <td className="num">{fmtINR(p.margin_inr)}</td>
                  <td className="num">{dur((p.closed_at ?? 0) - p.opened_at)}</td>
                  <td><Tag tone={p.close_reason === "target" ? "good" : p.close_reason === "stop" || p.close_reason === "liquidation" ? "bad" : "warn"}>{p.close_reason}</Tag></td>
                  <td className="num muted">{fmtINR(p.fees_inr)}</td>
                  <td className={`num ${p.pnl_inr >= 0 ? "good" : "bad"}`}>{fmtINRs(p.pnl_inr)}</td>
                  <td className="muted small ellipsis" style={{ maxWidth: 260 }} title={p.rationale}>{p.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {older.length > 0 && (
        <Card title="Earlier runs" aside={<span>{older.length} trades in the journal</span>} pad={false}>
          <table className="table">
            <thead><tr><th>Closed</th><th>Desk</th><th>Side</th><th>Entry → Exit</th><th>Lev</th><th>Held</th><th>Exit via</th><th>P&L</th></tr></thead>
            <tbody>
              {older.map((t) => (
                <tr key={t.id}>
                  <td className="muted small">{dateTime(t.closed_at)}</td>
                  <td><b>{coin(t.symbol)}</b></td>
                  <td><Stance s={t.side} /></td>
                  <td className="num">{fmtUSD(t.entry)} → {fmtUSD(t.exit)}</td>
                  <td className="num">{t.leverage}x</td>
                  <td className="num">{dur(t.closed_at - t.opened_at)}</td>
                  <td><Tag tone={t.close_reason === "target" ? "good" : t.close_reason === "stop" ? "bad" : "warn"}>{t.close_reason}</Tag></td>
                  <td className={`num ${t.pnl_inr >= 0 ? "good" : "bad"}`}>{fmtINRs(t.pnl_inr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <PasscodeModal open={needKey} onClose={() => setNeedKey(false)} />
    </>
  );
}
