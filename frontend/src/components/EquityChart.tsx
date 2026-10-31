import type { EquityPoint } from "../types";
import { clock, fmtINR, fmtINRs, pct } from "../format";
import { Card } from "./ui";

export function EquityChart({ points, capital, height = 180, title = "Equity" }: { points: EquityPoint[]; capital: number; height?: number; title?: string }) {
  const W = 600, H = height, pad = 8;
  const pts = points.length > 1 ? points : [{ ts: Date.now() / 1000 - 60, equity: points[0]?.equity ?? capital }, { ts: Date.now() / 1000, equity: points[0]?.equity ?? capital }];
  const vals = pts.map((p) => p.equity).concat([capital]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || capital * 0.001;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - pad * 2);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1].equity;
  const up = last >= capital;
  return (
    <Card title={title} aside={<span className={up ? "good" : "bad"}>{fmtINRs(last - capital)} · {pct((last / capital - 1) * 100)}</span>} pad={false}>
      <svg viewBox={`0 0 ${W} ${H}`} className="eq" style={{ height }} preserveAspectRatio="none">
        <line x1={0} x2={W} y1={y(capital)} y2={y(capital)} className="eq-base" />
        <path d={`${d} L${x(pts.length - 1)},${H} L${x(0)},${H} Z`} className={`eq-area ${up ? "good" : "bad"}`} />
        <path d={d} className={`eq-line ${up ? "good" : "bad"}`} />
      </svg>
      <div className="row between muted xs" style={{ padding: "6px 14px 10px" }}>
        <span>{clock(pts[0].ts)} → {clock(pts[pts.length - 1].ts)} · every 30s</span>
        <span>{fmtINR(lo)} – {fmtINR(hi)}</span>
      </div>
    </Card>
  );
}
