from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


_HOSTED = os.getenv("LLM_PROVIDER", "").strip().lower() in ("openai", "groq", "compatible")
_HOSTED_URL = "https://api.groq.com/openai/v1"
_HOSTED_MODEL = "qwen/qwen3.8-27b"


def _env(key: str, default, cast=str):
    raw = os.getenv(key)
    if raw is None or raw.strip() == "":
        return default
    raw = raw.split("#", 1)[0].strip()
    try:
        return cast(raw)
    except (TypeError, ValueError):
        return default


def _symbols() -> list[str]:
    raw = _env("SYMBOLS", "BTCUSDT,ETHUSDT,SOLUSDT")
    return [s.strip().upper() for s in raw.split(",") if s.strip()]


@dataclass
class Settings:
    symbols: list[str] = field(default_factory=_symbols)
    market_mode: str = _env("MARKET_MODE", "live").lower()
    candle_interval: str = _env("CANDLE_INTERVAL", "1m")
    history: int = _env("HISTORY_CANDLES", 300, int)

    capital_inr: float = _env("CAPITAL_INR", 2_500_000, float)
    usdinr: float = _env("USDINR", 0.0, float)
    fee_rate: float = _env("FEE_RATE", 0.0004, float)
    max_committed: float = _env("MAX_COMMITTED", 0.30, float)
    max_per_position: float = _env("MAX_PER_POSITION", 0.15, float)
    max_leverage: int = _env("MAX_LEVERAGE", 5, int)
    min_stop_atr: float = 0.8
    max_loss_per_trade: float = 0.01      # 1% of capital at the stop
    daily_loss_limit: float = 0.05        # compliance halts new entries below this drawdown

    # Agents. "ollama" talks to a local Ollama; "openai" talks to any OpenAI-compatible endpoint
    # (Groq by default), which is how a hosted deployment gets fast open models without a GPU box.
    llm_provider: str = _env("LLM_PROVIDER", "ollama").lower()
    llm_api_key: str = _env("LLM_API_KEY", "")
    ollama_url: str = _env("OLLAMA_URL", _HOSTED_URL if _HOSTED else "http://localhost:11434").rstrip("/")
    ollama_model: str = _env("OLLAMA_MODEL", _HOSTED_MODEL if _HOSTED else "llama3.2")
    ollama_timeout: float = _env("OLLAMA_TIMEOUT", 180.0, float)

    # Who makes the final call. "human": meetings end with a recommendation and wait for you.
    ceo_mode: str = _env("CEO_MODE", "human").lower()
    decision_timeout_sec: int = _env("DECISION_TIMEOUT_SEC", 300, int)
    decision_timeout_action: str = _env("DECISION_TIMEOUT_ACTION", "stand_down").lower()  # stand_down | follow_advisor
    ceo_passcode: str = _env("CEO_PASSCODE", "")          # empty = no auth on control endpoints

    meeting_interval_sec: int = _env("MEETING_INTERVAL_SEC", 180, int)
    scan_interval_sec: int = _env("SCAN_INTERVAL_SEC", 20, int)
    setup_threshold: float = _env("SETUP_THRESHOLD", 0.35, float)
    min_meeting_gap_sec: int = 60

    db_path: Path = ROOT / _env("DB_PATH", "data/firm.db")
    host: str = _env("HOST", "127.0.0.1")
    port: int = _env("PORT", 8000, int)

    max_staff: int = 25
    hire_every_trades: int = 4
    coffee_chance: float = 0.015           # per idle agent per tick


settings = Settings()
