export interface Agent {
  id: string;
  name: string;
  role: string;
  title: string;
  desk: string | null;
  personality: string;
  risk_appetite: number;
  status: "working" | "boardroom" | "coffee" | "arriving";
  status_until: number;
  last_statement: string;
  last_stance: string;
  meetings: number;
  calls: number;
}

export interface Market {
  ready?: boolean;
  price: number;
  bid: number;
  ask: number;
  spread_pct: number;
  rsi: number | null;
  ema9: number;
  ema21: number;
  ema50: number;
  macd_hist: number | null;
  macd_rising: boolean | null;
  atr: number;
  atr_pct: number;
  chg_15: number;
  chg_60: number;
  vol_ratio: number;
  hi_60: number;
  lo_60: number;
  regime: string;
  score: number;
}

export interface Position {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  qty: number;
  entry: number;
  leverage: number;
  margin_inr: number;
  notional_inr: number;
  stop: number;
  target: number;
  opened_at: number;
  desk: string;
  rationale: string;
  fees_inr: number;
  status: string;
  mark: number | null;
  unrealized_inr: number;
  unrealized_pct: number;
  exit: number | null;
  closed_at: number | null;
  close_reason: string | null;
  pnl_inr: number;
}

export interface Entry {
  ts: number;
  agent_id: string;
  name: string;
  role: string;
  title: string;
  desk: string | null;
  stance: string;
  confidence: number;
  statement: string;
  source: string;
  approve?: boolean;
  notes?: string[];
  decision?: string;
  size_pct?: number;
  sized?: Record<string, number> | null;
}

export interface Meeting {
  id: number;
  symbol: string;
  trigger: string;
  started: number;
  ended?: number;
  status: "live" | "done";
  transcript: Entry[];
  decision: string | null;
  conviction: number | null;
  executed: boolean;
  outcome: string;
  snapshot: Partial<Market>;
  attendees: string[];
}

export interface Summary {
  capital: number;
  cash: number;
  equity: number;
  pnl: number;
  pnl_pct: number;
  realized: number;
  unrealized: number;
  fees: number;
  committed: number;
  committed_pct: number;
  open_positions: number;
  closed_trades: number;
  usdinr: number;
}

export interface FirmInfo {
  name: string;
  started_at: number;
  paused: boolean;
  symbols: string[];
  market_source: string;
  market_connected: boolean;
  llm: { model: string; available: boolean; calls: number; failures: number; avg_latency: number; error: string | null };
  limits: { max_committed: number; max_per_position: number; max_leverage: number; max_loss_per_trade: number };
  staff: number;
  max_staff: number;
}

export interface Stats {
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  avg_win: number;
  avg_loss: number;
  profit_factor: number;
  expectancy: number;
  best: number;
  worst: number;
  avg_hold_sec: number;
  max_drawdown_pct: number;
  meetings: number;
  meetings_executed: number;
  by_symbol: Record<string, { trades: number; pnl: number; wins: number }>;
  by_reason: Record<string, number>;
}

export interface Ev {
  ts: number;
  kind: string;
  text: string;
  symbol: string | null;
  [k: string]: unknown;
}

export interface EquityPoint {
  ts: number;
  equity: number;
}

export interface State {
  connected: boolean;
  firm: FirmInfo | null;
  summary: Summary | null;
  markets: Record<string, Market>;
  agents: Agent[];
  positions: Position[];
  closed: Position[];
  meeting: Meeting | null;
  meetings: Meeting[];
  events: Ev[];
  equity: EquityPoint[];
  stats: Stats | null;
}
