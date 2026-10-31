import { EquityChart } from "../components/EquityChart";
import { Card, Empty, Meter } from "../components/ui";
import { coin, dur, fmtINR, fmtINRs, label, pct0 } from "../format";
import { useFirm } from "../store";

export function JournalPage() {
  const s = useFirm();
  const st = s.stats;
  if (!st) return null;
  const desks = Object.entries(st.by_symbol ?? {});
  const reasons = Object.entries(st.by_reason ?? {});
  const deciders = Object.entries(st.by_decider ?? {});
  const totalTrades = st.trades || 1;
  return (
    <>
      <div className="page-h">
        <div>
          <h1>Journal</h1>
          <p>Every trade and every meeting across every run. Judge the firm here, not on one lucky hour.</p>
        </div>
        <a className="btn ghost" href="/api/trades.csv">Export CSV</a>
      </div>

      <Card title="Performance" pad={false}>
        <div className="stats-grid">
          <div className="cell"><div className="l">Trades</div><div className="v">{st.trades}</div><div className="s">{st.wins} wins · {st.losses} losses</div></div>
          <div className="cell"><div className="l">Win rate</div><div className="v">{pct0(st.win_rate, 0)}</div></div>
          <div className="cell"><div className="l">Profit factor</div><div className="v">{st.trades ? st.profit_factor.toFixed(2) : "–"}</div><div className="s">gross win ÷ gross loss</div></div>
          <div className="cell"><div className="l">Expectancy</div><div className={`v ${st.expectancy >= 0 ? "good" : "bad"}`}>{fmtINRs(st.expectancy)}</div><div className="s">per trade</div></div>
          <div className="cell"><div className="l">Total P&L</div><div className={`v ${st.total_pnl >= 0 ? "good" : "bad"}`}>{fmtINRs(st.total_pnl)}</div><div className="s">journaled, all runs</div></div>
          <div className="cell"><div className="l">Avg win / loss</div><div className="v" style={{ fontSize: 13 }}>{fmtINR(st.avg_win)} / {fmtINR(st.avg_loss)}</div></div>
          <div className="cell"><div className="l">Best / worst</div><div className="v" style={{ fontSize: 13 }}><span className="good">{fmtINRs(st.best)}</span> / <span className="bad">{fmtINRs(st.worst)}</span></div></div>
          <div className="cell"><div className="l">Max drawdown</div><div className="v">{pct0(st.max_drawdown_pct)}</div><div className="s">on the equity curve</div></div>
          <div className="cell"><div className="l">Avg hold</div><div className="v">{dur(st.avg_hold_sec)}</div></div>
          <div className="cell"><div className="l">Meetings</div><div className="v">{st.meetings}</div><div className="s">{st.meetings_executed} ended in a trade</div></div>
          <div className="cell"><div className="l">Your decisions</div><div className="v">{st.by_decider?.human ?? 0}</div><div className="s">{st.by_decider?.timeout ?? 0} left to the deadline</div></div>
          <div className="cell"><div className="l">Autopilot decisions</div><div className="v">{st.by_decider?.ai ?? 0}</div></div>
        </div>
      </Card>

      <div className="grid c3">
        <Card title="By desk">
          {desks.length === 0 ? <Empty title="No trades yet." /> : (
            <div className="stack" style={{ gap: 12 }}>
              {desks.map(([sym, d]) => (
                <div key={sym}>
                  <div className="row between small"><b>{coin(sym)}</b><span className={d.pnl >= 0 ? "good" : "bad"}>{fmtINRs(d.pnl)}</span></div>
                  <Meter value={d.trades} max={totalTrades} tone={d.pnl >= 0 ? "good" : "bad"} />
                  <div className="muted xs">{d.trades} trades · {d.wins} wins · {d.trades ? ((d.wins / d.trades) * 100).toFixed(0) : 0}%</div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="By exit">
          {reasons.length === 0 ? <Empty title="No exits yet." /> : (
            <div className="stack" style={{ gap: 12 }}>
              {reasons.map(([r, n]) => (
                <div key={r}>
                  <div className="row between small"><b>{label(r)}</b><span className="mono">{n}</span></div>
                  <Meter value={n} max={totalTrades} tone={r === "target" ? "good" : r === "stop" || r === "liquidation" ? "bad" : ""} />
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Who decided">
          {deciders.length === 0 ? <Empty title="No meetings yet." /> : (
            <div className="stack" style={{ gap: 12 }}>
              {deciders.map(([who, n]) => (
                <div key={who}>
                  <div className="row between small"><b>{who === "human" ? "You" : who === "timeout" ? "Deadline default" : "Autopilot"}</b><span className="mono">{n}</span></div>
                  <Meter value={n} max={st.meetings || 1} tone={who === "human" ? "" : who === "timeout" ? "bad" : "blue"} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <EquityChart points={s.equity} capital={s.summary!.capital} height={220} title="Equity · this session" />
    </>
  );
}
