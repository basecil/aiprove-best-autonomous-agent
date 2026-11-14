# eth-backtest — entry (eth-pnl-fixed)

Trend-following strategy over the frozen ETH 1-minute dataset (`bars.csv`,
1,440 real ETH/USDT spot bars, Binance, 24h ending 2026-11-13 12:17 UTC).

- **Strategy:** `strategy.mjs` — dual moving-average crossover on closes:
  long 1 unit when MA(32) > MA(128), short 1 unit otherwise; fills at the
  next bar's open. One robust rule, no fitted parameters: the whole slow-MA
  family (24/96, 32/128, 48/192) is positive on the public bars.
- **Replay:** `node backtest.mjs` — 5 bps fee per side on traded notional.
- **Result on the public bars:** PnL **+$16.90** per 1 ETH unit, 14 trades,
  max drawdown $72.38 (buy & hold over the same window: -$33.18).
