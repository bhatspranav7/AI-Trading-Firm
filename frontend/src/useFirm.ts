import { useEffect, useReducer } from "react";
import type { Meeting, Position, State } from "./types";

const initial: State = {
  connected: false,
  firm: null,
  summary: null,
  markets: {},
  agents: [],
  positions: [],
  closed: [],
  meeting: null,
  meetings: [],
  events: [],
  equity: [],
  stats: null,
};

type Msg = { type: string; [k: string]: any };

function upsertPosition(list: Position[], symbol: string, pos: Position | null): Position[] {
  const rest = list.filter((p) => p.symbol !== symbol);
  return pos ? [...rest, pos].sort((a, b) => a.symbol.localeCompare(b.symbol)) : rest;
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
        summary: msg.summary,
        markets: msg.markets,
        agents: msg.agents,
        positions: msg.positions,
        closed: msg.closed,
        meeting: msg.meeting,
        meetings: msg.meetings,
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
      };
    case "agents":
      return { ...state, agents: msg.agents };
    case "meeting": {
      const m: Meeting = msg.meeting;
      if (m.status === "live") return { ...state, meeting: m };
      const meetings = [...state.meetings.filter((x) => x.id !== m.id), m].slice(-20);
      return { ...state, meeting: null, meetings };
    }
    case "statement": {
      if (!state.meeting || state.meeting.id !== msg.meeting_id) return state;
      const dup = state.meeting.transcript.some((e) => e.ts === msg.entry.ts && e.agent_id === msg.entry.agent_id);
      if (dup) return state;
      return { ...state, meeting: { ...state.meeting, transcript: [...state.meeting.transcript, msg.entry] } };
    }
    case "positions": {
      const closed = msg.closed ? [...state.closed.filter((c) => c.id !== msg.closed.id), msg.closed].slice(-100) : state.closed;
      return { ...state, positions: msg.positions, summary: msg.summary, closed, stats: msg.stats ?? state.stats };
    }
    case "event":
      return { ...state, events: [...state.events, msg.event].slice(-150) };
    case "equity":
      return { ...state, equity: [...state.equity, msg.point].slice(-2000), summary: msg.summary };
    default:
      return state;
  }
}

export function useFirm() {
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

  return state;
}

export async function post(path: string) {
  const r = await fetch(path, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
