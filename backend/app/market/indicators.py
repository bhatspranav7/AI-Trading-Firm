"""Pure-python indicator stack: EMA, RSI, MACD, ATR plus a combined snapshot."""
from __future__ import annotations


def ema(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    k = 2 / (period + 1)
    out = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def rsi(closes: list[float], period: int = 14) -> float | None:
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    avg_g = sum(gains[:period]) / period
    avg_l = sum(losses[:period]) / period
    for g, l in zip(gains[period:], losses[period:]):
        avg_g = (avg_g * (period - 1) + g) / period
        avg_l = (avg_l * (period - 1) + l) / period
    if avg_l == 0:
        return 100.0
    return 100 - 100 / (1 + avg_g / avg_l)


def macd(closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9) -> dict | None:
    if len(closes) < slow + signal:
        return None
    line = [a - b for a, b in zip(ema(closes, fast), ema(closes, slow))]
    sig = ema(line[slow - 1:], signal)
    m, s = line[-1], sig[-1]
    prev = line[-2] - sig[-2] if len(sig) > 1 else m - s
    return {"macd": m, "signal": s, "hist": m - s, "hist_prev": prev}


def atr(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> float | None:
    if len(closes) < period + 1:
        return None
    trs = []
    for i in range(1, len(closes)):
        trs.append(max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1])))
    a = sum(trs[:period]) / period
    for tr in trs[period:]:
        a = (a * (period - 1) + tr) / period
    return a


def snapshot(candles: list[dict]) -> dict:
    closes = [c["close"] for c in candles]
    if len(closes) < 60:
        return {"ready": False, "candles": len(closes)}
    highs = [c["high"] for c in candles]
    lows = [c["low"] for c in candles]
    vols = [c["volume"] for c in candles]
    price = closes[-1]

    e9, e21, e50 = ema(closes, 9)[-1], ema(closes, 21)[-1], ema(closes, 50)[-1]
    r = rsi(closes)
    m = macd(closes)
    a = atr(highs, lows, closes)

    chg_15 = (price / closes[-16] - 1) * 100
    chg_60 = (price / closes[-61] - 1) * 100 if len(closes) > 61 else (price / closes[0] - 1) * 100
    base_vol = sum(vols[-60:]) / 60
    vol_ratio = (sum(vols[-5:]) / 5) / base_vol if base_vol > 0 else 1.0
    hi_60, lo_60 = max(highs[-60:]), min(lows[-60:])
    atr_pct = (a / price * 100) if a else 0.0

    score = 0.25 if e9 > e21 else -0.25
    score += 0.15 if e21 > e50 else -0.15
    if r is not None:
        if r > 70:
            score -= 0.25
        elif r < 30:
            score += 0.25
        elif r > 55:
            score += 0.10
        elif r < 45:
            score -= 0.10
    if m:
        score += 0.20 if m["hist"] > 0 else -0.20
        score += 0.10 if m["hist"] > m["hist_prev"] else -0.10
    score = max(-1.0, min(1.0, score))

    trend_gap = abs(e9 - e50) / price * 100
    if atr_pct > 0.35:
        regime = "volatile"
    elif trend_gap > 0.4:
        regime = "trending"
    else:
        regime = "ranging"

    return {
        "ready": True,
        "candles": len(closes),
        "price": price,
        "ema9": e9, "ema21": e21, "ema50": e50,
        "rsi": r,
        "macd": m["macd"] if m else None,
        "macd_signal": m["signal"] if m else None,
        "macd_hist": m["hist"] if m else None,
        "macd_rising": (m["hist"] > m["hist_prev"]) if m else None,
        "atr": a, "atr_pct": atr_pct,
        "chg_15": chg_15, "chg_60": chg_60,
        "vol_ratio": vol_ratio,
        "hi_60": hi_60, "lo_60": lo_60,
        "regime": regime,
        "score": score,
    }
