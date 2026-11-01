import { useEffect, useState } from "react";
import { Btn, Card, PasscodeModal, Tag, useAction } from "../components/ui";
import { api, getKey, setKey, useFirm } from "../store";
import type { Settings } from "../types";

type Form = Pick<Settings, "ceo_mode" | "decision_timeout_sec" | "decision_timeout_action" | "max_committed" | "max_per_position" | "max_leverage" | "max_loss_per_trade" | "daily_loss_limit" | "setup_threshold" | "meeting_interval_sec" | "scan_interval_sec" | "ollama_model" | "ollama_url" | "llm_provider">;

export function SettingsPage() {
  const s = useFirm();
  const { busy, error, needKey, setNeedKey, run } = useAction();
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);
  const [key, setKeyState] = useState(getKey());

  useEffect(() => {
    if (s.settings && !form) {
      const { ceo_mode, decision_timeout_sec, decision_timeout_action, max_committed, max_per_position, max_leverage, max_loss_per_trade, daily_loss_limit, setup_threshold, meeting_interval_sec, scan_interval_sec, ollama_model, ollama_url, llm_provider } = s.settings;
      setForm({ ceo_mode, decision_timeout_sec, decision_timeout_action, max_committed, max_per_position, max_leverage, max_loss_per_trade, daily_loss_limit, setup_threshold, meeting_interval_sec, scan_interval_sec, ollama_model, ollama_url, llm_provider });
    }
  }, [s.settings, form]);

  if (!form || !s.settings || !s.firm) return null;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm({ ...form, [k]: v }); setSaved(false); };
  const pctField = (k: "max_committed" | "max_per_position" | "max_loss_per_trade" | "daily_loss_limit", labelText: string, hint: string, min = 0.5, max = 100) => (
    <div className="field">
      <label><span>{labelText}</span><span className="mono">{(form[k] * 100).toFixed(1)}%</span></label>
      <input type="number" min={min} max={max} step={0.5} value={+(form[k] * 100).toFixed(1)} onChange={(e) => set(k, +e.target.value / 100)} />
      <div className="hint">{hint}</div>
    </div>
  );

  const save = async () => {
    const ok = await run(() => api("/api/settings", "POST", form));
    if (ok) setSaved(true);
  };

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Settings</h1>
          <p>Runtime controls. Changes apply immediately to the next meeting and the next sizing.</p>
        </div>
        <div className="row gap">
          {saved && <Tag tone="good">saved</Tag>}
          <Btn tone="primary" disabled={busy} onClick={save}>Save changes</Btn>
        </div>
      </div>
      {error && <div className="alert bad">{error}</div>}

      <div className="grid c2">
        <Card title="Who decides">
          <div className="stack">
            <div className="field">
              <label><span>CEO</span></label>
              <select value={form.ceo_mode} onChange={(e) => set("ceo_mode", e.target.value as Form["ceo_mode"])}>
                <option value="human">You. Meetings end in a recommendation and wait for your call.</option>
                <option value="ai">Autopilot. The chief executive agent decides.</option>
              </select>
            </div>
            <div className="grid c2">
              <div className="field">
                <label><span>Decision deadline</span><span className="mono">{form.decision_timeout_sec}s</span></label>
                <input type="number" min={30} max={3600} step={30} value={form.decision_timeout_sec} onChange={(e) => set("decision_timeout_sec", +e.target.value)} />
                <div className="hint">how long a decision waits for you</div>
              </div>
              <div className="field">
                <label><span>When the deadline passes</span></label>
                <select value={form.decision_timeout_action} onChange={(e) => set("decision_timeout_action", e.target.value as Form["decision_timeout_action"])}>
                  <option value="stand_down">Stand down / hold</option>
                  <option value="follow_advisor">Follow the chief of staff</option>
                </select>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Risk rulebook" aside={<span>enforced in code, not in prompts</span>}>
          <div className="grid c2">
            {pctField("max_committed", "Firm exposure cap", "margin across all desks", 5, 100)}
            {pctField("max_per_position", "Per-position cap", "margin in one position", 1, 100)}
            {pctField("max_loss_per_trade", "Risk per trade", "loss at the stop, as % of capital", 0.1, 10)}
            {pctField("daily_loss_limit", "Drawdown halt", "compliance blocks new entries below this", 1, 50)}
            <div className="field">
              <label><span>Max leverage</span><span className="mono">{form.max_leverage}x</span></label>
              <input type="number" min={1} max={20} step={1} value={form.max_leverage} onChange={(e) => set("max_leverage", +e.target.value)} />
            </div>
          </div>
        </Card>

        <Card title="Boardroom cadence">
          <div className="grid c2">
            <div className="field">
              <label><span>Setup threshold</span><span className="mono">{form.setup_threshold.toFixed(2)}</span></label>
              <input type="number" min={0.1} max={1} step={0.05} value={form.setup_threshold} onChange={(e) => set("setup_threshold", +e.target.value)} />
              <div className="hint">|indicator bias| that triggers an unscheduled meeting</div>
            </div>
            <div className="field">
              <label><span>Scheduled review</span><span className="mono">{form.meeting_interval_sec}s</span></label>
              <input type="number" min={60} max={3600} step={30} value={form.meeting_interval_sec} onChange={(e) => set("meeting_interval_sec", +e.target.value)} />
              <div className="hint">per desk, when nothing else triggers</div>
            </div>
            <div className="field">
              <label><span>Scan interval</span><span className="mono">{form.scan_interval_sec}s</span></label>
              <input type="number" min={5} max={300} step={5} value={form.scan_interval_sec} onChange={(e) => set("scan_interval_sec", +e.target.value)} />
            </div>
          </div>
        </Card>

        <Card title="Agents" aside={<Tag tone={s.firm.llm.available ? "good" : "warn"}>{s.firm.llm.available ? `online · ${s.firm.llm.avg_latency}s/call` : "offline · heuristics"}</Tag>}>
          <div className="stack">
            <div className="field">
              <label><span>Provider</span></label>
              <select value={form.llm_provider} onChange={(e) => set("llm_provider", e.target.value)}>
                <option value="ollama">Ollama on this machine. Open models, no key, CPU or GPU speed.</option>
                <option value="openai">Hosted OpenAI-compatible endpoint (Groq, Together, OpenRouter…). Needs LLM_API_KEY in the environment.</option>
              </select>
            </div>
            <div className="grid c2">
              <div className="field">
                <label><span>Model</span></label>
                <input type="text" value={form.ollama_model} onChange={(e) => set("ollama_model", e.target.value)} />
                <div className="hint">{form.llm_provider === "openai" ? "on Groq qwen/qwen3.8-27b answers in under a second; if a model is retired the firm picks the closest one offered" : "llama3.2 is fast on CPU; llama3.1:8b or qwen2.5:7b argue better"}</div>
              </div>
              <div className="field">
                <label><span>Endpoint</span></label>
                <input type="text" value={form.ollama_url} onChange={(e) => set("ollama_url", e.target.value)} />
                <div className="hint">{form.llm_provider === "openai" ? "base URL ending in /v1" : "where Ollama listens"}</div>
              </div>
            </div>
            <div className="small muted">
              {s.firm.llm.calls} calls this run · {s.firm.llm.failures} failures · {s.firm.llm.repairs} cut short and repaired{s.firm.llm.error ? ` · ${s.firm.llm.error}` : ""}. Each meeting is about seven calls.
            </div>
          </div>
        </Card>

        <Card title="Access" aside={<Tag tone={s.settings.auth_required ? "gold" : "soft"}>{s.settings.auth_required ? "passcode required" : "open"}</Tag>}>
          <div className="stack">
            <div className="small dim">
              Set <code>CEO_PASSCODE</code> in the environment to lock every control endpoint when you deploy. Reads stay public, so the landing page and the dashboard still show live state.
            </div>
            <div className="field">
              <label><span>Your passcode (stored in this browser only)</span></label>
              <div className="row gap">
                <input type="password" value={key} onChange={(e) => setKeyState(e.target.value)} placeholder="passcode" />
                <Btn onClick={() => { setKey(key); setSaved(true); }}>Remember</Btn>
              </div>
            </div>
          </div>
        </Card>

        <Card title="This deployment">
          <div className="stack small dim">
            <div>Capital <b className="mono">₹{s.settings.capital_inr.toLocaleString("en-IN")}</b> · fee <b className="mono">{(s.settings.fee_rate * 100).toFixed(2)}%</b> per side · candles <b className="mono">{s.settings.candle_interval}</b> · desks <b className="mono">{s.settings.symbols.join(", ")}</b>. These are set in <code>.env</code> and need a restart.</div>
            <div>Run anywhere with Docker: <code>docker compose up -d</code> then <code>docker compose exec ollama ollama pull {form.ollama_model}</code>.</div>
          </div>
        </Card>
      </div>
      <PasscodeModal open={needKey} onClose={() => setNeedKey(false)} />
    </>
  );
}
