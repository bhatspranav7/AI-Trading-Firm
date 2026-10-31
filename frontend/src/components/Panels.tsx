import { useEffect, useRef } from "react";
import type { EquityPoint, Ev, Market, Position, Stats } from "../types";
import { clock, coin, dur, fmtINR, fmtINRs, fmtUSD, pct, pct0 } from "../format";

export function Positions({ positions, markets }: { positions: Position[]; markets: Record<string, Market> }) {
  return (
    <div className="panel">
      <div className="panel-head"><h3>Open positions</h3><span className="muted small">{positions.length} running</span></div>
      {positions.length === 0 ? (
        <div className="muted small pad">Flat across all desks.</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr><th>Desk</th><th>Side</th><th>Entry</th><th>Mark</th><th>Stop / Target</th><th>Lev</th><th>Margin</th><th>uP&L</th></tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const m = markets[p.symbol];
              const mark = p.mark ?? m?.price;
              const range = Math.abs(p.target - p.stop) || 1;
              const prog = Math.max(0, Math.min(1, ((mark ?? p.entry) - Math.min(p.stop, p.target)) / range));
              return (
                <tr key={p.id}>
                  <td><b>{coin(p.symbol)}</b></td>
                  <td><span className={`stance st-${p.side.toLowerCase()}`}>{p.side}</span></td>
                  <td className="mono">{fmtUSD(p.entry)}</td>
                  <td className="mono">{fmtUSD(mark)}</td>
                  <td>
                    <div className="st-bar" title={`stop ${fmtUSD(p.stop)} · target ${fmtUSD(p.target)}`}>
                      <div className="st-marker" style={{ left: `${(p.side === "LONG" ? prog : 1 - prog) * 100}%` }} />
                    </div>
                    <div className="muted small mono">{fmtUSD(p.stop)} → {fmtUSD(p.target)}</div>
                  </td>
                  <td className="mono">{p.leverage}x</td>
                  <td className="mono">{fmtINR(p.margin_inr)}</td>
                  <td className={`mono ${p.unrealized_inr >= 0 ? "pos" : "neg"}`}>{fmtINRs(p.unrealized_inr)}<div className="small">{pct(p.unrealized_pct, 1)}</div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function EquityChart({ points, capital }: { points: EquityPoint[]; capital: number }) {
  const W = 600, H = 140, pad = 6;
  const pts = points.length > 1
    ? points
    : [{ ts: Date.now() / 1000 - 60, equity: capital }, { ts: Date.now() / 1000, equity: points[0]?.equity ?? capital }];
  const vals = pts.map((p) => p.equity).concat([capital]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - pad * 2);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1].equity;
  const up = last >= capital;
  return (
    <div className="panel">
      <div className="panel-head"><h3>Equity</h3><span className={`small ${up ? "pos" : "neg"}`}>{fmtINRs(last - capital)} · {pct((last / capital - 1) * 100)}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="eq" preserveAspectRatio="none">
        <line x1={0} x2={W} y1={y(capital)} y2={y(capital)} className="eq-base" />
        <path d={`${d} L${x(pts.length - 1)},${H} L${x(0)},${H} Z`} className={`eq-area ${up ? "pos" : "neg"}`} />
        <path d={d} className={`eq-line ${up ? "pos" : "neg"}`} />
      </svg>
      <div className="muted small pad-x">snapshots every 30s · range {fmtINR(lo)} – {fmtINR(hi)}</div>
    </div>
  );
}

export function StatsPanel({ stats }: { stats: Stats | null }) {
  if (!stats) return null;
  const cells: [string, string, string?][] = [
    ["Trades", String(stats.trades)],
    ["Win rate", pct0(stats.win_rate, 0), `${stats.wins}W / ${stats.losses}L`],
    ["Profit factor", stats.trades ? stats.profit_factor.toFixed(2) : "–"],
    ["Expectancy", fmtINRs(stats.expectancy), "per trade"],
    ["Avg win / loss", `${fmtINR(stats.avg_win)} / ${fmtINR(stats.avg_loss)}`],
    ["Max drawdown", pct0(stats.max_drawdown_pct)],
    ["Avg hold", dur(stats.avg_hold_sec)],
    ["Meetings", `${stats.meetings_executed}/${stats.meetings}`, "ended in a trade"],
  ];
  const reasons = Object.entries(stats.by_reason ?? {});
  return (
    <div className="panel">
      <div className="panel-head"><h3>Journal</h3><span className="muted small">judge it over hundreds of trades, not one session</span></div>
      <div className="stats">
        {cells.map(([l, v, s]) => (
          <div key={l} className="cell"><div className="label">{l}</div><div className="value">{v}</div>{s && <div className="sub">{s}</div>}</div>
        ))}
      </div>
      {reasons.length > 0 && (
        <div className="muted small pad-x">exits · {reasons.map(([r, n]) => `${r} ${n}`).join(" · ")}</div>
      )}
      {Object.keys(stats.by_symbol ?? {}).length > 0 && (
        <div className="muted small pad-x">
          by desk · {Object.entries(stats.by_symbol).map(([s, d]) => `${coin(s)} ${d.trades}t ${fmtINRs(d.pnl)}`).join(" · ")}
        </div>
      )}
    </div>
  );
}

export function EventFeed({ events }: { events: Ev[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);
  return (
    <div className="panel feed-panel">
      <div className="panel-head"><h3>Office log</h3><span className="muted small">{events.length} events</span></div>
      <div className="feed" ref={ref}>
        {events.map((e, i) => (
          <div key={`${e.ts}-${i}`} className={`ev k-${e.kind}`}>
            <span className="muted small mono">{clock(e.ts)}</span>
            <span className="ev-kind">{e.kind}</span>
            <span className="ev-text">{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TradeLog({ closed }: { closed: Position[] }) {
  const rows = [...closed].reverse();
  return (
    <div className="panel log">
      <div className="panel-head"><h3>Closed trades</h3><span className="muted small">{rows.length} this session</span></div>
      {rows.length === 0 ? (
        <div className="muted small pad">Nothing closed yet.</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr><th>Closed</th><th>Desk</th><th>Side</th><th>Entry → Exit</th><th>Lev</th><th>Margin</th><th>Held</th><th>Exit via</th><th>P&L</th><th>Rationale</th></tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="mono small">{clock(p.closed_at ?? p.opened_at)}</td>
                <td><b>{coin(p.symbol)}</b></td>
                <td><span className={`stance st-${p.side.toLowerCase()}`}>{p.side}</span></td>
                <td className="mono">{fmtUSD(p.entry)} → {fmtUSD(p.exit)}</td>
                <td className="mono">{p.leverage}x</td>
                <td className="mono">{fmtINR(p.margin_inr)}</td>
                <td className="mono">{dur((p.closed_at ?? 0) - p.opened_at)}</td>
                <td><span className={`tag reason-${p.close_reason}`}>{p.close_reason}</span></td>
                <td className={`mono ${p.pnl_inr >= 0 ? "pos" : "neg"}`}>{fmtINRs(p.pnl_inr)}</td>
                <td className="muted small rationale" title={p.rationale}>{p.rationale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
