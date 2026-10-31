import { useEffect, useRef } from "react";
import { createChart, IChartApi, IPriceLine, ISeriesApi, LineStyle, UTCTimestamp } from "lightweight-charts";
import type { Candle, Position } from "../types";

function ema(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

const COLORS = { e9: "#5b9cff", e21: "#c9a961", e50: "#9b8cff" };

export function CandleChart({ candles, position, height = 420 }: { candles: Candle[]; position?: Position | null; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const emas = useRef<Record<string, ISeriesApi<"Line">>>({});
  const lines = useRef<IPriceLine[]>([]);
  const lastLen = useRef(0);

  useEffect(() => {
    if (!ref.current) return;
    const c = createChart(ref.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#7f8ca3", fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
      grid: { vertLines: { color: "#161f30" }, horzLines: { color: "#161f30" } },
      rightPriceScale: { borderColor: "#1f2a3c" },
      timeScale: { borderColor: "#1f2a3c", timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: 0 },
    });
    const cs = c.addCandlestickSeries({ upColor: "#2fd39a", downColor: "#f25c6f", borderVisible: false, wickUpColor: "#2fd39a", wickDownColor: "#f25c6f" });
    emas.current = {
      e9: c.addLineSeries({ color: COLORS.e9, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }),
      e21: c.addLineSeries({ color: COLORS.e21, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }),
      e50: c.addLineSeries({ color: COLORS.e50, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }),
    };
    chart.current = c;
    series.current = cs;
    lastLen.current = 0;
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  useEffect(() => {
    const cs = series.current;
    if (!cs || !candles.length) return;
    const data = candles.map((x) => ({ time: x.time as UTCTimestamp, open: x.open, high: x.high, low: x.low, close: x.close }));
    const closes = candles.map((x) => x.close);
    const e = { e9: ema(closes, 9), e21: ema(closes, 21), e50: ema(closes, 50) };
    const full = lastLen.current === 0 || Math.abs(candles.length - lastLen.current) > 1;
    if (full) {
      cs.setData(data);
      (Object.keys(e) as (keyof typeof e)[]).forEach((k) => emas.current[k].setData(e[k].map((v, i) => ({ time: data[i].time, value: v }))));
      chart.current?.timeScale().scrollToRealTime();
    } else {
      const i = data.length - 1;
      cs.update(data[i]);
      (Object.keys(e) as (keyof typeof e)[]).forEach((k) => emas.current[k].update({ time: data[i].time, value: e[k][i] }));
    }
    lastLen.current = candles.length;
  }, [candles]);

  useEffect(() => {
    const cs = series.current;
    if (!cs) return;
    lines.current.forEach((l) => cs.removePriceLine(l));
    lines.current = [];
    if (!position) return;
    const mk = (price: number, color: string, title: string, style = LineStyle.Dashed) =>
      cs.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
    lines.current.push(mk(position.entry, "#e9eef6", `${position.side} entry`, LineStyle.Solid));
    lines.current.push(mk(position.stop, "#f25c6f", "stop"));
    lines.current.push(mk(position.target, "#2fd39a", "target"));
  }, [position?.id, position?.stop, position?.target]);

  return (
    <div className="chart-wrap" style={{ height }}>
      <div className="chart-legend">
        <span><i style={{ background: COLORS.e9 }} />EMA 9</span>
        <span><i style={{ background: COLORS.e21 }} />EMA 21</span>
        <span><i style={{ background: COLORS.e50 }} />EMA 50</span>
      </div>
      <div ref={ref} style={{ position: "absolute", inset: 0 }} />
    </div>
  );
}
