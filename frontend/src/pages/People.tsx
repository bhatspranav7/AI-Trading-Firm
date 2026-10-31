import { Avatar, Card, Meter, Stance, Tag } from "../components/ui";
import { coin } from "../format";
import { useFirm } from "../store";
import type { Agent } from "../types";

function Person({ a }: { a: Agent }) {
  return (
    <div className="person">
      <div className="person-h">
        <Avatar name={a.name} role={a.role} status={a.status} size={42} />
        <div className="grow">
          <div className="person-n">{a.name}</div>
          <div className="person-t">{a.title}{a.desk ? ` · ${coin(a.desk)} desk` : ""}</div>
        </div>
        {a.status === "boardroom" && <Tag tone="gold">boardroom</Tag>}
        {a.status === "coffee" && <Tag tone="soft">coffee</Tag>}
        {a.status === "arriving" && <Tag tone="blue">arriving</Tag>}
      </div>
      <div className="person-p">{a.personality}</div>
      <div className="appetite">
        <span style={{ width: 90 }}>Risk appetite</span>
        <div className="grow"><Meter value={a.risk_appetite} max={1} tone={a.risk_appetite > 0.65 ? "bad" : a.risk_appetite > 0.4 ? "" : "blue"} /></div>
        <span className="mono">{(a.risk_appetite * 100).toFixed(0)}</span>
      </div>
      <div className="row between small muted">
        <span>{a.meetings} meetings · {a.calls} statements</span>
        {a.last_stance && <Stance s={a.last_stance} />}
      </div>
      {a.last_statement && <div className="person-q">“{a.last_statement}”</div>}
    </div>
  );
}

export function People() {
  const s = useFirm();
  const f = s.firm!;
  const execs = s.agents.filter((a) => !a.desk);
  return (
    <>
      <div className="page-h">
        <div>
          <h1>People</h1>
          <p>{f.staff} of {f.max_staff} seats filled. The firm hires as trades close; new hires walk in through reception.</p>
        </div>
      </div>

      <Card title="Executive floor">
        <div className="grid c4">
          {f.ceo_mode === "human" && (
            <div className="person" style={{ borderColor: "var(--gold)" }}>
              <div className="person-h">
                <Avatar name="You" role="CEO" status="human" size={42} />
                <div className="grow">
                  <div className="person-n">You</div>
                  <div className="person-t">Chief Executive Officer</div>
                </div>
                <Tag tone="gold">final call</Tag>
              </div>
              <div className="person-p">Every trade waits for your decision. The chief of staff recommends; you dispose.</div>
              <div className="row between small muted">
                <span>{s.stats?.by_decider?.human ?? 0} decisions · {s.stats?.by_decider?.timeout ?? 0} left to the deadline</span>
              </div>
            </div>
          )}
          {execs.map((a) => <Person key={a.id} a={a} />)}
        </div>
      </Card>

      {f.symbols.map((sym) => (
        <Card key={sym} title={`${coin(sym)} desk`} aside={<span>{s.agents.filter((a) => a.desk === sym).length} people</span>}>
          <div className="grid c3">
            {s.agents.filter((a) => a.desk === sym).map((a) => <Person key={a.id} a={a} />)}
          </div>
        </Card>
      ))}
    </>
  );
}
