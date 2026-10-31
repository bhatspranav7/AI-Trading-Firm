# AI Trading Firm

Not a bot. A whole office.

An AI paper-trading firm where **19 to 25 AI employees** across three desks argue in a boardroom, and only then does a trade happen. One desk per coin (BTC, ETH, SOL). Live Binance prices, real indicators, real spread and fees, ATR stops, P&L in rupees. Every decision is a **typed JSON object** from an open-source model running locally, not free text.

Everything here is paper money. No exchange keys, no real orders.

## Who works there

| Role | Count | What they do |
| --- | --- | --- |
| CEO | 1 | Makes the final call on every trade: LONG, SHORT or stand down; HOLD, CLOSE or FLIP on an open position |
| Managing Director | 1 | Owns the P&L, pushes for size |
| Risk Manager | 1 | Sizes trades, sets stop and target in ATR multiples, kills bad ones |
| Compliance | 1 | Watches exposure caps, stale data, wide spreads, drawdown limit |
| Desk Lead | 3 | One per desk, spots the setup and calls the meeting |
| Quant Analyst | 3 | Reads the indicator stack |
| Research Analyst | 3 | Reads regime and context |
| Execution Trader | 6 | Momentum, spread, fills |

The firm opens with 19 staff and hires up to 25 as trades close. New hires walk in through reception. People take coffee breaks. Each agent has a personality and a risk appetite, and one quant on the BTC desk enjoys taking the other side of the room.

## How a trade gets made

1. A desk lead sees the indicator bias cross the setup threshold, or the scheduled review comes round, and calls the desk to the boardroom. The other two desks keep working.
2. The lead, the quant, the research analyst, one trader and the MD each give a typed opinion: stance, confidence, and what they say to the room. Each one sees what colleagues said before them and can push back by name.
3. The risk manager approves or rejects and proposes size, leverage, stop and target. The deterministic risk desk then clamps that against the firm rules: 30% committed cap, 15% per position, 5x leverage, 1% of capital at risk per trade, minimum 1.2 reward to risk.
4. Compliance checks exposure, data freshness, spread and the 5% drawdown halt.
5. The CEO calls it with a conviction score. Below 50% conviction the firm stands down regardless.
6. The ledger fills at the ask or bid, charges fees, and watches the stop and target on every tick. Liquidation at 95% of margin lost.

Every meeting, statement and trade is written to a SQLite journal so the firm can be judged over hundreds of trades, not one lucky session.

## Stack

- **Backend**: Python 3.11+, FastAPI, WebSockets. Binance public market data, no API key.
- **Agents**: [Ollama](https://ollama.com) running an open-source model locally. Default `llama3.2`. Structured output via JSON schema, so every decision parses.
- **Dashboard**: React + Vite + TypeScript. Office floor, executive row, live boardroom transcript, positions, equity curve, journal stats, office log.
- **Fallback**: if Ollama is down the firm keeps running on rule-based heuristics and marks every such statement as `heuristic` in the transcript. If Binance is unreachable the feed switches to a random-walk simulation and the header says so.

## Run it

Prerequisites: Python 3.11+, Node 18+, [Ollama](https://ollama.com/download).

```bash
ollama pull llama3.2
```

Backend:

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # Windows; use source .venv/bin/activate elsewhere
pip install -r requirements.txt
python run.py
```

Dashboard (development, with hot reload, on http://localhost:5173):

```bash
cd frontend
npm install
npm run dev
```

Or build it once and let the backend serve it on http://127.0.0.1:8000:

```bash
cd frontend && npm run build
```

Copy `.env.example` to `.env` to change capital, symbols, caps, model, or cadence.

## Speed notes

Each meeting is about seven model calls. On a CPU-only machine with a 3B model that is roughly 15 to 25 seconds per call, so a meeting takes a few minutes and the other desks keep trading around it. A GPU, or a smaller `num_predict`, makes it near real time. A bigger model (`llama3.1:8b`, `qwen2.5:7b`) argues better but is slower on CPU.

## API

| Method | Path | What |
| --- | --- | --- |
| GET | `/api/state` | Full snapshot: firm, summary, markets, agents, positions, meeting, events, equity, stats |
| GET | `/api/trades` | Closed trades from the journal |
| GET | `/api/meetings` | Past meetings with full transcripts |
| GET | `/api/stats` | Win rate, profit factor, expectancy, drawdown, by desk, by exit reason |
| POST | `/api/meeting/{symbol}` | Call a desk into the boardroom now |
| POST | `/api/kill` | Close everything at market and pause |
| POST | `/api/resume` | Resume |
| WS | `/ws` | Snapshot on connect, then ticks, statements, meetings, positions, events, equity |

## Straight up

Paper trading on live prices. The model is disciplined and consistent, but it does not predict the market. The interesting part is not the P&L. It is 25 agents with different personalities reaching a decision none of them would reach alone, and a risk desk that stops them when they are wrong together.
