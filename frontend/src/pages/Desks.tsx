import { Link, useNavigate, useParams } from "react-router-dom";
import { CandleChart } from "../components/CandleChart";
import { Transcript } from "../components/Transcript";
import { Avatar, Bias, Btn, Card, Countdown, PasscodeModal, Stance, Tag, useAction } from "../components/ui";
import { clock, coin, fmtINR, fmtINRs, fmtUSD, label, pct, pct0 } from "../format";
import { api, useFirm } from "../store";

export function Desks() {
  const s = useFirm();
  const { symbol } = useParams();
  const nav = useNavigate();
  const { busy, error, needKey, setNeedKey, run } = useAction();
  const f = s.firm!;
  const sym = symbol && f.symbols.includes(symbol.toUpperCase()) ? symbol.toUpperCase() : f.symbols[0];
  const m = s.markets[sym];
  const pos = s.positions.find((p) => p.symbol === sym);
  const team = s.agents.filter((a) => a.desk === sym);
  const pend = s.pending.find((p) => p.symbol === sym);
  const live = s.meeting?.symbol === sym ? s.meeting : null;
  const recent = s.meetings.filter((x) => x.symbol === sym && x.status === "done").slice(-5).reverse();
  const candles = s.candles[sym] ?? [];

  return (
    <>
      <div className="page-h">
        <div>
          <h1>{coin(sym)} desk</h1>
          <p>{team.length} people · {live ? "in the boardroom" : pend ? "waiting on your decision" : "working the book"}</p>
        </div>
        <div className="row gap">
          {f.symbols.map((x) => (
            <Link key={x} to={`/app/desks/${x}`} className={`btn ${x === sym ? "primary" : "ghost"}`}>{coin(x)}</Link>
          ))}
        </div>
      </div>

      <div className="grid main-side">
        <div className="stack">
          <Card
            title={<span className="row gap"><span className="price">{m?.ready ? fmtUSD(m.price) : "…"}</span>{m?.ready && <span className={`chg ${m.chg_60 >= 0 ? "good" : "bad"}`}>{pct(m.chg_15)} 15m · {pct(m.chg_60)} 1h</span>}</span>}
            aside={<span className="mono">{f.market_source === "binance" ? "Binance spot · 1m" : "simulation · 1m"} · {candles.length} candles</span>}
            pad={false}
          >
            {candles.length ? <CandleChart candles={candles} position={pos} /> : <div className="muted small" style={{ padding: 14 }}>Loading candles…</div>}
          </Card>

          {live && (
            <Card title={<span className="row gap">Boardroom <Tag tone="warn">live</Tag></span>}>
              <Transcript m={live} live />
            </Card>
          )}

          {recent.length > 0 && (
            <Card title="Recent meetings on this desk" pad={false}>
              {recent.map((x) => (
                <div key={x.id} className="hist-row" onClick={() => nav(`/app/boardroom/${x.id}`)}>
                  <span className="muted xs mono">{clock(x.started)}</span>
                  <b>{coin(x.symbol)}</b>
                  <span className="muted small ellipsis">{x.trigger}</span>
                  <Stance s={x.decision} />
                  <span className="muted xs">{((x.conviction ?? 0) * 100).toFixed(0)}%</span>
                  <span className="muted xs">{x.decided_by === "human" ? "your call" : x.decided_by === "timeout" ? "deadline" : label(x.decided_by)}</span>
                  <span className="muted xs ellipsis">{x.outcome}</span>
                </div>
              ))}
            </Card>
          )}
        </div>

        <div className="stack">
          {pend && (
            <div className="alert gold">
              <div className="grow"><b>Waiting on you.</b> <span className="dim">{pend.recommendation?.by} recommends {label(pend.recommendation?.decision)}.</span></div>
              <Countdown deadline={pend.deadline ?? 0} />
              <Btn tone="primary" size="sm" onClick={() => nav(`/app/boardroom/${pend.id}`)}>Decide</Btn>
            </div>
          )}

          <Card title="Position" aside={pos ? <Stance s={pos.side} /> : <span>flat</span>}>
            {pos ? (
              <div className="stack" style={{ gap: 10 }}>
                <div className="grid c2">
                  <div className="kpi"><div className="kpi-l">Unrealized</div><div className={`kpi-v ${pos.unrealized_inr >= 0 ? "good" : "bad"}`}>{fmtINRs(pos.unrealized_inr)}</div><div className="kpi-s">{pct(pos.unrealized_pct, 1)} on margin</div></div>
                  <div className="kpi"><div className="kpi-l">Size</div><div className="kpi-v">{pos.qty.toFixed(4)}</div><div className="kpi-s">{pos.leverage}x · margin {fmtINR(pos.margin_inr)}</div></div>
                  <div className="kpi"><div className="kpi-l">Entry · Mark</div><div className="kpi-v" style={{ fontSize: 14 }}>{fmtUSD(pos.entry)} · {fmtUSD(pos.mark)}</div></div>
                  <div className="kpi"><div className="kpi-l">Stop · Target</div><div className="kpi-v" style={{ fontSize: 14 }}><span className="bad">{fmtUSD(pos.stop)}</span> · <span className="good">{fmtUSD(pos.target)}</span></div></div>
                </div>
                <div className="small muted">Opened {clock(pos.opened_at)}. “{pos.rationale}”</div>
                <Btn tone="bad" disabled={busy} onClick={() => run(() => api(`/api/positions/${sym}/close`, "POST"))}>Close at market</Btn>
                {error && <div className="form-err">{error}</div>}
              </div>
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                <div className="muted small">No open position on this desk.</div>
                <Btn tone="primary" disabled={busy || !!s.meeting || !!pend || f.paused} onClick={() => run(() => api(`/api/meeting/${sym}`, "POST"))}>Call the desk to the boardroom</Btn>
                {error && <div className="form-err">{error}</div>}
              </div>
            )}
          </Card>

          {m?.ready && (
            <Card title="Indicator stack" aside={<span className={`regime ${m.regime}`}>{m.regime}</span>}>
              <div className="stack" style={{ gap: 8 }}>
                <Bias score={m.score} />
                <div className="row between small"><span className="muted">Bias score</span><b className="mono">{m.score.toFixed(2)}</b></div>
                <div className="row between small"><span className="muted">RSI 14</span><b className="mono">{m.rsi?.toFixed(1)}</b></div>
                <div className="row between small"><span className="muted">EMA 9 / 21 / 50</span><b className="mono">{fmtUSD(m.ema9)} / {fmtUSD(m.ema21)} / {fmtUSD(m.ema50)}</b></div>
                <div className="row between small"><span className="muted">MACD histogram</span><b className={`mono ${(m.macd_hist ?? 0) >= 0 ? "good" : "bad"}`}>{(m.macd_hist ?? 0).toFixed(2)} {m.macd_rising ? "↑" : "↓"}</b></div>
                <div className="row between small"><span className="muted">ATR 14</span><b className="mono">{fmtUSD(m.atr)} · {pct0(m.atr_pct, 2)}</b></div>
                <div className="row between small"><span className="muted">Spread</span><b className="mono">{m.spread_pct.toFixed(3)}%</b></div>
                <div className="row between small"><span className="muted">Volume vs 1h</span><b className="mono">{m.vol_ratio.toFixed(2)}x</b></div>
                <div className="row between small"><span className="muted">60m range</span><b className="mono">{fmtUSD(m.lo_60)} – {fmtUSD(m.hi_60)}</b></div>
              </div>
            </Card>
          )}

          <Card title="The desk" aside={<Link to="/app/people" className="small">people →</Link>}>
            <div className="stack" style={{ gap: 8 }}>
              {team.map((a) => (
                <div key={a.id} className={`chip s-${a.status}`} title={a.personality}>
                  <Avatar name={a.name} role={a.role} status={a.status} size={30} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="chip-n">{a.name}</div>
                    <div className="chip-r">
                      {a.title}
                      {a.status === "coffee" && <Tag tone="soft">coffee</Tag>}
                      {a.status === "arriving" && <Tag tone="blue">arriving</Tag>}
                      {a.status === "boardroom" && <Tag tone="gold">boardroom</Tag>}
                    </div>
                  </div>
                  {a.last_stance && <Stance s={a.last_stance} />}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      <PasscodeModal open={needKey} onClose={() => setNeedKey(false)} />
    </>
  );
}
