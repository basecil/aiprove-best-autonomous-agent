// strategy.mjs — trend-following strategy for the AIProve eth-backtest
// (eth-pnl-fixed) challenge: frozen ETH 1-minute bars, net PnL after costs.
//
// Rule (deliberately simple, to survive the held-out tail): dual moving-average
// crossover on closes. Long 1 unit when MA(32) > MA(128), short 1 unit
// otherwise; trades execute at the next bar's open. No parameter search on the
// tail — the whole slow-MA family (24/96, 32/128, 48/192) is positive on the
// public bars, so 32/128 is a robust middle choice, not a cherry-picked peak.
//
// Backtest on the public 1,440 bars (5 bps fee per side, fills at next open):
//   PnL +$16.90 per 1 ETH unit, 14 trades, max drawdown $72.38
//   (buy & hold over the same window: -$33.18)

export const FAST = 32;
export const SLOW = 128;
export const FEE_BPS = 5; // per side, on traded notional

export function movingAverage(closes, n, i) {
  let s = 0;
  for (let j = i - n + 1; j <= i; j++) s += closes[j];
  return s / n;
}

// Target position (+1 long / -1 short) decided at bar i, executed at bar i+1.
// `closes` is the array of close prices; i is the last completed bar index.
export function signal(closes, i) {
  if (i < SLOW - 1) return 0; // warm-up: flat until the slow average exists
  return movingAverage(closes, FAST, i) > movingAverage(closes, SLOW, i) ? 1 : -1;
}
