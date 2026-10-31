import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import type { Candle, Meeting, Position, State, Toast } from "./types";

// ----------------------------------------------------------------- API client
const KEY = "ceo_key";
export const getKey = () => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};
export const setKey = (k: string) => {
  try {
    k ? localStorage.setItem(KEY, k) : localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
};

export class AuthError extends Error {
  constructor() {
    super("CEO passcode required");
    this.name = "AuthError";
  }
}

export async function api<T = any>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const k = getKey();
  if (k) headers["X-CEO-Key"] = k;
  const r = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 401) throw new AuthError();
  if (!r.ok) {
    let msg = r.statusText;
    try {
      msg = (await r.json()).detail ?? msg;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  return r.json();
}

// -------------------------------------------------------------------- state
const initial: State = {
  connected: false,
  firm: null,
  settings: null,
  summary: null,
  markets: {},
  candles: {},
  agents: [],
  positions: [],
  closed: [],
  meeting: null,
  meetings: [],
  pending: [],
  events: [],
  equity: [],
  stats: null,
  toasts: [],
};

type Msg = { type: string; [k: string]: any };
const TOAST_KINDS = new Set(["trade", "close", "decision_needed", "decision", "hire", "override", "firm"]);
let toastId = 0;

function upsertPosition(list: Position[], symbol: string, pos: Position | null): Position[] {
  const rest = list.filter((p) => p.symbol !== symbol);
  return pos ? [...rest, pos].sort((a, b) => a.symbol.localeCompare(b.symbol)) : rest;
}

function upsertMeeting(list: Meeting[], m: Meeting): Meeting[] {
  return [...list.filter((x) => x.id !== m.id), m].sort((a, b) => a.started - b.started).slice(-40);
}

function pushCandle(list: Candle[] | undefined, c: Candle | null): Candle[] | undefined {
  if (!list || !c) return list;
  const last = list[list.length - 1];
  if (last && last.time === c.time) return [...list.slice(0, -1), c];
  if (last && last.time > c.time) return list;
  return [...list, c].slice(-600);
}

function reducer(state: State, msg: Msg): State {
  switch (msg.type) {
    case "connected":
      return { ...state, connected: true };
    case "disconnected":
      return { ...state, connected: false };
    case "snapshot":
      return {
        ...state,
        connected: true,
        firm: msg.firm,
        settings: msg.settings,
        summary: msg.summary,
        markets: msg.markets,
        agents: msg.agents,
        positions: msg.positions,
        closed: msg.closed,
        meeting: msg.meeting,
        meetings: msg.meetings,
        pending: msg.pending ?? [],
        events: msg.events,
        equity: msg.equity_curve,
        stats: msg.stats,
      };
    case "tick":
      return {
        ...state,
        markets: { ...state.markets, [msg.symbol]: msg.market },
        summary: msg.summary,
        positions: upsertPosition(state.positions, msg.symbol, msg.position),
        candles: { ...state.candles, [msg.symbol]: pushCandle(state.candles[msg.symbol], msg.candle) ?? state.candles[msg.symbol] },
      };
    case "candles_loaded":
      return { ...state, candles: { ...state.candles, [msg.symbol]: msg.candles } };
    case "agents":
      return { ...state, agents: msg.agents };
    case "meeting": {
      const m: Meeting = msg.meeting;
      if (m.status === "live") return { ...state, meeting: m };
      const meetings = upsertMeeting(state.meetings, m);
      const pending = m.status === "awaiting_ceo" ? upsertMeeting(state.pending, m) : state.pending.filter((p) => p.id !== m.id);
      return { ...state, meeting: state.meeting?.id === m.id ? null : state.meeting, meetings, pending };
    }
    case "pending":
      return { ...state, pending: msg.pending };
    case "statement": {
      const add = (m: Meeting) =>
        m.id !== msg.meeting_id || m.transcript.some((e) => e.ts === msg.entry.ts && e.agent_id === msg.entry.agent_id)
          ? m
          : { ...m, transcript: [...m.transcript, msg.entry] };
      return {
        ...state,
        meeting: state.meeting ? add(state.meeting) : null,
        pending: state.pending.map(add),
        meetings: state.meetings.map(add),
      };
    }
    case "positions": {
      const closed = msg.closed ? [...state.closed.filter((c) => c.id !== msg.closed.id), msg.closed].slice(-200) : state.closed;
      return { ...state, positions: msg.positions, summary: msg.summary, closed, stats: msg.stats ?? state.stats };
    }
    case "event": {
      const ev = msg.event;
      const toasts = TOAST_KINDS.has(ev.kind)
        ? [...state.toasts, { id: ++toastId, kind: ev.kind, text: ev.text, ts: ev.ts, meeting_id: ev.meeting_id } as Toast].slice(-5)
        : state.toasts;
      return { ...state, events: [...state.events, ev].slice(-300), toasts };
    }
    case "dismiss_toast":
      return { ...state, toasts: state.toasts.filter((t) => t.id !== msg.id) };
    case "equity":
      return { ...state, equity: [...state.equity, msg.point].slice(-2000), summary: msg.summary };
    default:
      return state;
  }
}

// ------------------------------------------------------------------ context
const Ctx = createContext<{ state: State; dismissToast: (id: number) => void } | null>(null);

export function FirmProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: number | undefined;
    let ping: number | undefined;
    let closed = false;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        dispatch({ type: "connected" });
        ping = window.setInterval(() => ws?.readyState === 1 && ws.send("ping"), 20000);
      };
      ws.onmessage = (ev) => dispatch(JSON.parse(ev.data));
      ws.onclose = () => {
        dispatch({ type: "disconnected" });
        window.clearInterval(ping);
        if (!closed) timer = window.setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      window.clearInterval(ping);
      ws?.close();
    };
  }, []);

  const symbols = state.firm?.symbols.join(",");
  useEffect(() => {
    if (!symbols) return;
    for (const s of symbols.split(",")) {
      fetch(`/api/candles/${s}`)
        .then((r) => r.json())
        .then((candles) => dispatch({ type: "candles_loaded", symbol: s, candles }))
        .catch(() => undefined);
    }
  }, [symbols, state.connected]);

  useEffect(() => {
    if (!state.toasts.length) return;
    const oldest = state.toasts[0];
    const t = window.setTimeout(() => dispatch({ type: "dismiss_toast", id: oldest.id }), 9000);
    return () => window.clearTimeout(t);
  }, [state.toasts]);

  const dismissToast = useCallback((id: number) => dispatch({ type: "dismiss_toast", id }), []);

  return <Ctx.Provider value={{ state, dismissToast }}>{children}</Ctx.Provider>;
}

export function useFirm() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useFirm outside FirmProvider");
  return c.state;
}

export function useDismissToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDismissToast outside FirmProvider");
  return c.dismissToast;
}
