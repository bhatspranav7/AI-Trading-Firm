# AI Trading Firm

**Not a bot. A whole firm, and you run it.**

Twenty-five AI employees across three desks argue every trade in a boardroom. Risk sizes it, compliance clears it, the chief of staff recommends. Then the decision comes to **you, the CEO**, with a countdown. Live Binance prices, real spreads and fees, paper capital in rupees, every meeting journaled.

Everything is paper money. No exchange keys, no real orders.

## What you get

- **A landing page** at `/` that pitches the firm with live numbers from the floor.
- **Command** at `/app`: three desk cards with sparklines, the boardroom feed, open positions, equity, journal stats and the office log.
- **Boardroom**: the live transcript of each argument and, when a meeting ends, **your decision desk**. Options are LONG / SHORT / STAND DOWN, or HOLD / CLOSE / FLIP when the desk already holds a position. Set your own size and leverage, override the risk desk if you must (it is logged), add a note for the record. A deadline counts down; when it passes the firm stands down, or follows the advisor if you prefer.
- **Desks**: a TradingView-style candlestick chart per coin with EMA 9/21/50 overlays and entry, stop and target lines when a position is open, the full indicator stack, the team, and a close-at-market button.
- **Book**: open risk, this session's closed trades, every trade from earlier runs, CSV export.
- **People**: the 19 to 25 staff with personality, risk appetite, last stance and last statement. You sit at the top.
- **Journal**: win rate, profit factor, expectancy, drawdown, by desk, by exit reason, by who decided.
- **Settings**: change the CEO mode, deadline, risk caps, cadence and model at runtime.
- **Deploy** as one container with Docker Compose, with an optional passcode on every control.

## Who works there

| Role | Count | What they do |
| --- | --- | --- |
| CEO | you | The final call on every trade |
| Chief of Staff | 1 | Weighs the room and recommends one option with a conviction score |
| Managing Director | 1 | Owns the P&L, pushes for size |
| Risk Manager | 1 | Proposes size, leverage, stop and target in ATR multiples; kills bad ideas |
| Compliance | 1 | Exposure caps, stale data, wide spreads, the drawdown halt |
| Desk Lead | 3 | One per coin, spots the setup and calls the meeting |
| Quant Analyst | 3 | Reads the indicator stack |
| Research Analyst | 3 | Reads regime and context |
| Execution Trader | 6 | Momentum, spread, fills |

Each agent has a personality and a risk appetite. One quant on the BTC desk enjoys taking the other side of the room. The firm opens with 19 and hires to 25 as trades close. They take coffee breaks.

## How a trade gets made

1. A desk lead sees the indicator bias cross the setup threshold, or a position needs review, or the scheduled check comes round. The desk and the executives go into the boardroom. The other desks keep working.
2. The lead, the quant, the research analyst, one trader and the MD each give a **typed** opinion: stance, confidence and what they say to the room. Each sees what colleagues said and can push back by name.
3. The risk manager proposes size, leverage, stop and target. The deterministic risk desk clamps it: 30% committed across the firm, 15% per position, 5x leverage, 1% of capital at risk at the stop, and the target must clear three round trips of fees or the stop and target widen until it does.
4. Compliance checks exposure, data freshness, spread and the 5% drawdown halt.
5. The chief of staff recommends with a conviction score. Under 50% conviction it recommends standing down.
6. **You decide.** The decision waits with a deadline. Your call, your size, your note go into the transcript as the CEO's line.
7. The ledger fills at the ask or bid, charges fees, and watches stop and target on every tick. Liquidation at 95% of margin lost.

Switch `CEO_MODE` to `ai` and the chief executive agent decides instead. Everything else stays the same.

## Stack

- **Backend**: Python 3.11+, FastAPI, WebSockets. Binance public market data with Bybit as the fallback venue (exchanges geo-block some hosting regions), no key needed.
- **Agents**: [Ollama](https://ollama.com) running an open-source model locally, default `llama3.2`, or any OpenAI-compatible endpoint (Groq by default) for hosted deployments. Structured output via JSON schema, so every decision parses. If Ollama is down the firm keeps running on rule-based heuristics and labels every such statement.
- **Dashboard**: React, TypeScript, Vite, React Router, TradingView lightweight-charts.
- **Journal**: SQLite.
- **Deploy**: Dockerfile and docker-compose with an Ollama service.

## Run it locally

Prerequisites: Python 3.11+, Node 18+, [Ollama](https://ollama.com/download).

```bash
ollama pull llama3.2
```

Backend:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows; use: source .venv/bin/activate elsewhere
pip install -r requirements.txt
python run.py
```

Dashboard, built once and served by the backend at http://127.0.0.1:8000:

```bash
cd frontend
npm install
npm run build
```

For UI work with hot reload use `npm run dev` and open http://localhost:5173; it proxies to the backend.

Copy `.env.example` to `.env` to change capital, coins, caps, model, cadence, CEO mode, deadline or passcode.

## Deploy

**Hosted, from a URL, in a few minutes (Render + Groq).** The repo carries a `render.yaml` blueprint. In Render choose New, then Blueprint, pick this repo, and it asks for two secrets: `LLM_API_KEY` (a free key from [console.groq.com](https://console.groq.com), which serves open Llama models in under a second) and `CEO_PASSCODE` (whatever you want to lock the controls with). The blueprint sets the provider, endpoint and model for you. The starter plan keeps a 1 GB disk for the journal; the free plan works too but sleeps when idle and forgets the journal on redeploy.

**Your own box with Ollama.**

```bash
docker compose up -d --build
docker compose exec ollama ollama pull llama3.2
```

The site is on port 8000. Set `CEO_PASSCODE` in the environment to lock every control endpoint; reads stay public so the landing page and dashboard show live state, and the browser asks you for the passcode the first time you act. For a GPU host uncomment the `deploy` block in `docker-compose.yml`.

**Any other host.** Build the Dockerfile and set `LLM_PROVIDER=openai`, `OLLAMA_URL=<base url ending in /v1>`, `OLLAMA_MODEL`, `LLM_API_KEY`. Groq, Together, Fireworks, OpenRouter and a vLLM server all speak this dialect.

## Speed

Each meeting is about seven model calls. On a CPU-only laptop with a 3B model that is 15 to 70 seconds a call depending on what else the machine is doing, so a meeting takes two to eight minutes and the other desks keep working around it. A GPU makes it near real time. A bigger model (`llama3.1:8b`, `qwen2.5:7b`) argues better and misreads fewer numbers, and is slower on CPU.

## API

| Method | Path | What |
| --- | --- | --- |
| GET | `/api/state` | Full snapshot |
| GET | `/api/pending` | Decisions waiting for the CEO |
| GET | `/api/candles/{symbol}` | Recent one-minute candles |
| GET | `/api/trades`, `/api/trades.csv` | The journal |
| GET | `/api/meetings` | Past meetings with transcripts |
| GET | `/api/stats` | Performance stats |
| GET | `/api/settings` | Runtime settings |
| POST | `/api/decide/{meeting_id}` | Your call: `{decision, size_pct?, leverage?, override_risk?, note?}` |
| POST | `/api/meeting/{symbol}` | Call a desk into the boardroom now |
| POST | `/api/positions/{symbol}/close` | Close at market |
| POST | `/api/kill`, `/api/resume` | Close everything and pause; resume |
| POST | `/api/settings` | Change runtime settings |
| WS | `/ws` | Snapshot on connect, then ticks, statements, meetings, pending, positions, events, equity |

Control endpoints take an `X-CEO-Key` header when `CEO_PASSCODE` is set.

## Straight up

Paper trading on live prices. The model is disciplined and consistent, but it does not predict the market. The interesting part is not the P&L. It is a room full of agents with different personalities reaching a decision none of them would reach alone, a risk desk that stops them when they are wrong together, and a human who has to own the final call.
