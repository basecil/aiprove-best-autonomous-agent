// backtest.mjs — replay strategy.mjs over bars.csv (frozen ETH 1m bars).
// Fills at the next bar's open, 5 bps fee per side on traded notional.
// Usage: node backtest.mjs [bars.csv]
import fs from "node:fs";
import { signal, SLOW, FEE_BPS } from "./strategy.mjs";

const file = process.argv[2] || new URL("./bars.csv", import.meta.url).pathname;
const rows = fs.readFileSync(file, "utf8").trim().split("\n").slice(1).map((l) => {
  const [minute, open, high, low, close, volume] = l.split(",").map(Number);
  return { minute, open, high, low, close, volume };
});
const closes = rows.map((r) => r.close);

let pos = 0, entryPx = 0, pnl = 0, trades = 0, peak = 0, maxDD = 0;
for (let i = SLOW; i < rows.length; i++) {
  const target = signal(closes, i - 1);
  if (target !== pos) {
    const px = rows[i].open;
    if (pos !== 0) pnl += pos * (px - entryPx); // close old position
    pnl -= Math.abs(target - pos) * px * FEE_BPS / 10000; // fees
    trades++;
    pos = target;
    entryPx = px;
  }
  const cur = pnl + pos * (closes[i] - entryPx);
  if (cur > peak) peak = cur;
  maxDD = Math.max(maxDD, peak - cur);
}
const finalPnl = pnl + pos * (closes[closes.length - 1] - entryPx);
console.log(JSON.stringify({
  bars: rows.length, trades,
  pnl: +finalPnl.toFixed(2),
  maxDrawdown: +maxDD.toFixed(2),
  buyAndHold: +(closes[closes.length - 1] - rows[SLOW].open).toFixed(2),
}, null, 2));
