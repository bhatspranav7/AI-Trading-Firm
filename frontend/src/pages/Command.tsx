import { Link, useNavigate } from "react-router-dom";
import { EquityChart } from "../components/EquityChart";
import { Transcript } from "../components/Transcript";
import { Avatar, Bias, Btn, Card, Countdown, Empty, KPI, PasscodeModal, Spark, Stance, Tag, useAction } from "../components/ui";
import { clock, coin, dur, fmtINR, fmtINRs, fmtUSD, label, pct, pct0 } from "../format";
import { api, useFirm } from "../store";

export function Command() {
  const s = useFirm();
  const nav = useNavigate();
  const { busy, needKey, setNeedKey, run } = useAction();
  const f = s.firm!;
  const live = s.meeting;
  const last = s.meetings.filter((m) => m.status === "done").slice(-1)[0];
  const st = s.stats;

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Command</h1>
          <p>Three desks, one boardroom, your call. {f.ceo_mode === "human" ? "Every trade waits for you." : "Autopilot: the chief executive agent decides."}</p>
        </div>
        <div className="row gap small muted">{clock(Date.now() / 1000)} · USD/INR {s.summary?.usdinr.toFixed(2)}</div>
      </div>

      <div className="grid c3">
        {f.symbols.map((sym) => {
          const m = s.markets[sym];
          const pos = s.positions.find((p) => p.symbol === sym);
          const team = s.agents.filter((a) => a.desk === sym);
          const pend = s.pending.find((p) => p.symbol === sym);
          const inMeeting = live?.symbol === sym;
          const closes = (s.candles[sym] ?? []).slice(-60).map((c) => c.close);
          return (
            <div key={sym} className={`desk ${inMeeting ? "meeting" : ""} ${pend ? "waiting" : ""}`}>
              <div className="desk-h">
                <div>
                  <Link to={`/app/desks/${sym}`} className="desk-name">{coin(sym)} desk →</Link>
                  <div className="muted small">
                    {team.length} people · {inMeeting ? <span className="gold">in the boardroom</span> : pend ? <span className="gold">waiting on you</span> : "working"}
                  </div>
                </div>
                <div className="right">
                  <div className="price">{m?.ready ? fmtUSD(m.price) : "…"}</div>
                  {m?.ready && <div className={`chg ${m.chg_60 >= 0 ? "good" : "bad"}`}>{pct(m.chg_15)} 15m · {pct(m.chg_60)} 1h</div>}
                </div>
              </div>
              <Spark values={closes} tone={closes.length > 1 && closes[closes.length - 1] >= closes[0] ? "good" : "bad"} />
              {m?.ready && (
                <>
                  <div className="ind">
                    <span>RSI <b>{m.rsi?.toFixed(0)}</b></span>
                    <span>ATR <b>{pct0(m.atr_pct, 2)}</b></span>
                    <span>vol <b>{m.vol_ratio.toFixed(1)}x</b></span>
                    <span className={`regime ${m.regime}`}>{m.regime}</span>
                  </div>
                  <Bias score={m.score} />
                </>
              )}
              <div className="row" style={{ gap: 4 }}>
                {team.map((a) => <Avatar key={a.id} name={a.name} role={a.role} status={a.status} size={24} />)}
              </div>
              <div className="row between">
                {pos ? (
                  <div className="small">
                    <Stance s={pos.side} /> <span className="mono">{pos.leverage}x</span>{" "}
                    <span className={`mono ${pos.unrealized_inr >= 0 ? "good" : "bad"}`}>{fmtINRs(pos.unrealized_inr)}</span>
                    <span className="muted"> ({pct(pos.unrealized_pct, 1)})</span>
                  </div>
                ) : (
                  <span className="muted small">flat</span>
                )}
                {pend ? (
                  <Btn tone="primary" size="sm" onClick={() => nav(`/app/boardroom/${pend.id}`)}>Decide · <Countdown deadline={pend.deadline ?? 0} /></Btn>
                ) : (
                  <Btn tone="ghost" size="sm" disabled={busy || !!live || f.paused} onClick={() => run(() => api(`/api/meeting/${sym}`, "POST"))}>Call meeting</Btn>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid main-side">
        <div className="stack">
          <Card
            title="Boardroom"
            aside={live ? <Tag tone="warn">live · {coin(live.symbol)}</Tag> : s.pending.length ? <Tag tone="gold">{s.pending.length} waiting on you</Tag> : <Link to="/app/boardroom" className="small">all meetings →</Link>}
          >
            {live ? (
              <Transcript m={live} live />
            ) : s.pending.length ? (
              <div className="stack">
                {s.pending.map((p) => (
                  <div key={p.id} className="rec">
                    <Avatar name={p.recommendation?.by ?? "A"} role="CEO" status="boardroom" size={38} />
                    <div className="grow">
                      <div className="rec-t">{coin(p.symbol)} · {p.recommendation?.by} recommends <b className="gold">{label(p.recommendation?.decision)}</b> at {((p.recommendation?.conviction ?? 0) * 100).toFixed(0)}%</div>
                      <div className="rec-q">“{p.recommendation?.statement}”</div>
                    </div>
                    <div className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
                      <Countdown deadline={p.deadline ?? 0} />
                      <Btn tone="primary" size="sm" onClick={() => nav(`/app/boardroom/${p.id}`)}>Decide</Btn>
                    </div>
                  </div>
                ))}
              </div>
            ) : last ? (
              <>
                <div className="row between" style={{ marginBottom: 10 }}>
                  <div className="muted small">Last meeting · {coin(last.symbol)} · {last.trigger} · {clock(last.started)}</div>
                  <div className="row gap"><Stance s={last.decision} /><span className="muted small">{((last.conviction ?? 0) * 100).toFixed(0)}%</span></div>
                </div>
                <Transcript m={last} scroll />
              </>
            ) : (
              <Empty title="The boardroom is empty." text="A desk lead calls the room when the indicator stack lines up, when a position needs review, or on the scheduled cadence. You can call one from any desk." />
            )}
          </Card>

          <Card title="Open positions" aside={<Link to="/app/book" className="small">book →</Link>} pad={false}>
            {s.positions.length === 0 ? (
              <div className="muted small" style={{ padding: 14 }}>Flat across all desks.</div>
            ) : (
              <table className="table">
                <thead><tr><th>Desk</th><th>Side</th><th>Entry</th><th>Mark</th><th>Stop</th><th>Target</th><th>Lev</th><th>Margin</th><th>Unrealized</th></tr></thead>
                <tbody>
                  {s.positions.map((p) => (
                    <tr key={p.id}>
                      <td><b>{coin(p.symbol)}</b></td>
                      <td><Stance s={p.side} /></td>
                      <td className="num">{fmtUSD(p.entry)}</td>
                      <td className="num">{fmtUSD(p.mark)}</td>
                      <td className="num bad">{fmtUSD(p.stop)}</td>
                      <td className="num good">{fmtUSD(p.target)}</td>
                      <td className="num">{p.leverage}x</td>
                      <td className="num">{fmtINR(p.margin_inr)}</td>
                      <td className={`num ${p.unrealized_inr >= 0 ? "good" : "bad"}`}>{fmtINRs(p.unrealized_inr)} <span className="muted xs">{pct(p.unrealized_pct, 1)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="stack">
          <EquityChart points={s.equity} capital={s.summary!.capital} title="Equity · this session" />
          {st && (
            <Card title="Journal" aside={<Link to="/app/journal" className="small">full journal →</Link>} pad={false}>
              <div className="stats-grid">
                <div className="cell"><div className="l">Trades</div><div className="v">{st.trades}</div><div className="s">{st.wins}W / {st.losses}L</div></div>
                <div className="cell"><div className="l">Win rate</div><div className="v">{pct0(st.win_rate, 0)}</div></div>
                <div className="cell"><div className="l">Profit factor</div><div className="v">{st.trades ? st.profit_factor.toFixed(2) : "–"}</div></div>
                <div className="cell"><div className="l">Expectancy</div><div className={`v ${st.expectancy >= 0 ? "good" : "bad"}`}>{fmtINRs(st.expectancy)}</div><div className="s">per trade</div></div>
                <div className="cell"><div className="l">Max drawdown</div><div className="v">{pct0(st.max_drawdown_pct)}</div></div>
                <div className="cell"><div className="l">Avg hold</div><div className="v">{dur(st.avg_hold_sec)}</div></div>
                <div className="cell"><div className="l">Meetings</div><div className="v">{st.meetings}</div><div className="s">{st.meetings_executed} traded</div></div>
                <div className="cell"><div className="l">Your calls</div><div className="v">{st.by_decider?.human ?? 0}</div><div className="s">{st.by_decider?.timeout ?? 0} timed out</div></div>
              </div>
            </Card>
          )}
          <Card title="Office log" aside={<span>{s.events.length} events</span>} pad={false} className="flush">
            <div className="feed">
              {[...s.events].reverse().slice(0, 60).map((e, i) => (
                <div key={`${e.ts}-${i}`} className={`ev k-${e.kind}`}>
                  <span className="muted xs mono">{clock(e.ts)}</span>
                  <span className="ev-k">{label(e.kind)}</span>
                  <span>{e.text}</span>
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
