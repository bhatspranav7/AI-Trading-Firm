const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inrSigned = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0, signDisplay: "always" });

export const fmtINR = (v: number | null | undefined) => (v == null ? "–" : `₹${inr.format(v)}`);
export const fmtINRs = (v: number | null | undefined) =>
  v == null ? "–" : `₹${inrSigned.format(v)}`.replace("₹-", "-₹").replace("₹+", "+₹");

export function fmtLakh(v: number | null | undefined) {
  if (v == null) return "–";
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
  return `${s}₹${inr.format(a)}`;
}

export function fmtUSD(v: number | null | undefined) {
  if (v == null) return "–";
  const digits = v >= 1000 ? 2 : v >= 10 ? 3 : 4;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export const pct = (v: number | null | undefined, d = 2) => (v == null ? "–" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
export const pct0 = (v: number | null | undefined, d = 1) => (v == null ? "–" : `${v.toFixed(d)}%`);

export const coin = (symbol: string) => symbol.replace("USDT", "");

export function ago(ts: number) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function clock(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString("en-IN", { hour12: false });
}

export function dateTime(ts: number) {
  return new Date(ts * 1000).toLocaleString("en-IN", { hour12: false, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function dur(sec: number) {
  if (!isFinite(sec) || sec < 0) return "–";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

export function mmss(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export const label = (s: string | null | undefined) => (s ?? "–").replace(/_/g, " ");
