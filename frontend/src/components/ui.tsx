import React, { useEffect, useState } from "react";
import { initials, label, mmss } from "../format";
import type { Status, Toast } from "../types";
import { api, AuthError, setKey } from "../store";
import { useDismissToast, useFirm } from "../store";

export function Card({ title, aside, children, className = "", pad = true }: {
  title?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || aside) && (
        <header className="card-h">
          <h3>{title}</h3>
          {aside && <div className="card-aside">{aside}</div>}
        </header>
      )}
      <div className={pad ? "card-b" : ""}>{children}</div>
    </section>
  );
}

export function KPI({ label: l, value, sub, tone, big }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "bad" | "muted" | "gold"; big?: boolean }) {
  return (
    <div className={`kpi ${big ? "big" : ""}`}>
      <div className="kpi-l">{l}</div>
      <div className={`kpi-v ${tone ?? ""}`}>{value}</div>
      {sub && <div className="kpi-s">{sub}</div>}
    </div>
  );
}

export function Tag({ children, tone = "", title }: { children: React.ReactNode; tone?: string; title?: string }) {
  return <span className={`tag ${tone}`} title={title}>{children}</span>;
}

export function Stance({ s, size }: { s: string | null | undefined; size?: "lg" }) {
  const v = (s ?? "").toLowerCase();
  return <span className={`stance ${v} ${size ?? ""}`}>{label(s)}</span>;
}

export function Avatar({ name, role, status, size = 32 }: { name: string; role: string; status?: Status | "human"; size?: number }) {
  return (
    <div className={`avatar r-${role.toLowerCase()} ${status ? `s-${status}` : ""}`} style={{ width: size, height: size, fontSize: size * 0.36 }} title={name}>
      {name === "You" ? "CEO" : initials(name)}
    </div>
  );
}

export function Btn({ children, tone = "", size = "", disabled, onClick, title, type = "button" }: {
  children: React.ReactNode; tone?: string; size?: string; disabled?: boolean; onClick?: () => void; title?: string; type?: "button" | "submit";
}) {
  return (
    <button type={type} className={`btn ${tone} ${size}`} disabled={disabled} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

export function Countdown({ deadline, className = "" }: { deadline: number; className?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 500);
    return () => window.clearInterval(t);
  }, []);
  const left = deadline - Date.now() / 1000;
  return <span className={`countdown ${left < 60 ? "urgent" : ""} ${className}`}>{mmss(left)}</span>;
}

export function Empty({ title, text }: { title: string; text?: string }) {
  return (
    <div className="empty">
      <div className="empty-t">{title}</div>
      {text && <div className="empty-x">{text}</div>}
    </div>
  );
}

export function Bias({ score }: { score: number }) {
  const w = Math.min(50, Math.abs(score) * 50);
  return (
    <div className="bias" title={`indicator bias ${score.toFixed(2)}`}>
      <div className="bias-mid" />
      <div className={`bias-fill ${score >= 0 ? "good" : "bad"}`} style={score >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
    </div>
  );
}

export function Meter({ value, max, tone = "" }: { value: number; max: number; tone?: string }) {
  return (
    <div className="meter">
      <div className={`meter-fill ${tone}`} style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
    </div>
  );
}

export function Spark({ values, tone }: { values: number[]; tone: "good" | "bad" | "muted" }) {
  if (values.length < 2) return <svg className="spark" viewBox="0 0 100 28" />;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${((i / (values.length - 1)) * 100).toFixed(1)},${(26 - ((v - lo) / span) * 24).toFixed(1)}`).join(" ");
  return (
    <svg className={`spark ${tone}`} viewBox="0 0 100 28" preserveAspectRatio="none">
      <path d={d} />
    </svg>
  );
}

export function Toasts() {
  const { toasts } = useFirm();
  const dismiss = useDismissToast();
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t: Toast) => (
        <div key={t.id} className={`toast k-${t.kind}`} onClick={() => dismiss(t.id)}>
          <div className="toast-k">{label(t.kind)}</div>
          <div className="toast-x">{t.text}</div>
        </div>
      ))}
    </div>
  );
}

/** Wraps a control action: handles the passcode prompt once and surfaces errors. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needKey, setNeedKey] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      if (e instanceof AuthError) setNeedKey(true);
      else setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, needKey, setNeedKey, run, clearError: () => setError(null) };
}

export function PasscodeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!open) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setKey(v.trim());
    try {
      await api("/api/auth/check");
      setErr(null);
      onClose();
    } catch {
      setErr("That passcode was not accepted.");
    }
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>CEO passcode</h3>
        <p className="muted">This deployment locks the controls. Enter the passcode set in <code>CEO_PASSCODE</code>.</p>
        <input autoFocus type="password" value={v} onChange={(e) => setV(e.target.value)} placeholder="passcode" />
        {err && <div className="form-err">{err}</div>}
        <div className="row end gap">
          <Btn tone="ghost" onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" type="submit">Unlock</Btn>
        </div>
      </form>
    </div>
  );
}
