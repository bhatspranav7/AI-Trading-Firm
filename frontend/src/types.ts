export type Status = "working" | "boardroom" | "coffee" | "arriving";

export interface Agent {
  id: string;
  name: string;
  role: string;
  title: string;
  desk: string | null;
  personality: string;
  risk_appetite: number;
  status: Status;
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

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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

export interface Sized {
  size_pct: number;
  margin_inr: number;
  notional_inr: number;
  leverage: number;
  fill: number;
  stop: number;
  target: number;
  stop_atr: number;
  target_atr: number;
  risk_inr: number;
  rr: number;
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
  sized?: Sized | null;
  recommendation?: boolean;
  override?: boolean;
}

export interface Meeting {
  id: number;
  symbol: string;
  trigger: string;
  started: number;
  ended?: number;
  deadline?: number;
  status: "live" | "awaiting_ceo" | "done";
  transcript: Entry[];
  decision: string | null;
  conviction: number | null;
  executed: boolean;
  outcome: string;
  snapshot: Partial<Market>;
  attendees: string[];
  decided_by: string | null;
  position: Position | null;
  options?: string[];
  consensus?: { side: string | null; strength: number };
  risk?: { approve: boolean; sized: Sized | null; notes: string[]; side: string | null };
  compliance?: { ok: boolean; notes: string[] };
  recommendation?: { decision: string; conviction: number; statement: string; by: string };
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
  llm: { provider: string; model: string; available: boolean; calls: number; failures: number; repairs: number; avg_latency: number; error: string | null };
  limits: { max_committed: number; max_per_position: number; max_leverage: number; max_loss_per_trade: number; daily_loss_limit: number };
  ceo_mode: "human" | "ai";
  decision_timeout_sec: number;
  staff: number;
  max_staff: number;
  auth_required: boolean;
}

export interface Settings {
  ceo_mode: "human" | "ai";
  decision_timeout_sec: number;
  decision_timeout_action: "stand_down" | "follow_advisor";
  max_committed: number;
  max_per_position: number;
  max_leverage: number;
  max_loss_per_trade: number;
  daily_loss_limit: number;
  setup_threshold: number;
  meeting_interval_sec: number;
  scan_interval_sec: number;
  ollama_model: string;
  ollama_url: string;
  llm_provider: string;
  symbols: string[];
  capital_inr: number;
  fee_rate: number;
  candle_interval: string;
  auth_required: boolean;
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
  by_decider: Record<string, number>;
}

export interface Ev {
  ts: number;
  kind: string;
  text: string;
  symbol: string | null;
  meeting_id?: number;
  decision?: string;
  [k: string]: unknown;
}

export interface EquityPoint {
  ts: number;
  equity: number;
}

export interface Toast {
  id: number;
  kind: string;
  text: string;
  ts: number;
  meeting_id?: number;
}

export interface State {
  connected: boolean;
  firm: FirmInfo | null;
  settings: Settings | null;
  summary: Summary | null;
  markets: Record<string, Market>;
  candles: Record<string, Candle[]>;
  agents: Agent[];
  positions: Position[];
  closed: Position[];
  meeting: Meeting | null;
  meetings: Meeting[];
  pending: Meeting[];
  events: Ev[];
  equity: EquityPoint[];
  stats: Stats | null;
  toasts: Toast[];
}
