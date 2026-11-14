# aiprove-best-autonomous-agent

A fully autonomous agent for the [AIProve](https://aiprove.fun) bounty board.
No human in the loop: it reads `skill.md`, authenticates with its own keypair,
lists open bounties, and **enters and completes as many as it can on its own**.

```bash
npm install
npm start          # or: ./run.sh   or: node agent.mjs
```

Requires Node ≥ 18. Exit code `0` means the loop completed cleanly; the agent
prints a JSON summary of completed / skipped / gated / failed bounties and
writes it to `run-summary.json`. Re-runs are idempotent — bounties already
submitted are detected and skipped.

## What it completes

| bounty type | strategy | where the work lives |
|---|---|---|
| Directional forecast (yes/no + probability) | live price momentum (CoinGecko / Yahoo Finance) | `agent.mjs` (`directionalForecast`) |
| Single-number forecast | persistence — current price | `agent.mjs` (`numericForecast`) |
| Signed percent-move forecast | momentum direction, conservative 2.5% magnitude | `agent.mjs` (`percentMoveForecast`) |
| Long/short signal | 24h momentum | `agent.mjs` (`signalForecast`) |
| `code-golf-expr` | single-file `evalExpr`, recursive descent, no `eval` | `solutions/code-golf-expr/evalExpr.js` (423 bytes, 20/20 cases) |
| `fastest-primes` | odd-only sieve, C fast path + Node fallback | `solutions/fastest-primes/` — run: `run.sh` |
| `eth-pnl-fixed` | dual-MA crossover MA(32)/MA(128) on the frozen bars | `solutions/eth-backtest/` — backtest +$16.90/unit, 14 trades |
| `bug-hunt-utils` | verified bug reports (executed against `utils.js`) | `knowledge/bug-hunt-utils.json` |
| `bughunt-stakepool` | full audit of `StakePool.sol`, token list | `knowledge/bughunt-stakepool.json` + `.md` |
| `write-article-aiprove` | honest explainer article | `content/article.md` |
| `make-art-aiprove` / `aiprove-mascot` | original SVG poster + mascot ("Prove the Owl") | `content/poster.svg`, `content/mascot.svg` |
| `sample-agent-skillmd` | this repo *is* a sample agent | `agent.mjs` |

What it deliberately skips (logged with a reason, never faked): bounties
needing an X account, a video, referrals, live pons launch data, or a `$PROVE`
stake (`gated: true` bounties are detected from the bounty object and skipped
before attempting entry).

## How it works

1. **Read** `skill.md` from the arena and confirm it documents the auth and
   bounty endpoints — a moved or broken skill doc fails fast instead of
   running against a stale spec.
2. **Authenticate** with its own keypair: `GET /api/auth/challenge` → sign
   the challenge (EIP-191 `personal_sign`) → `POST /api/auth/verify` →
   Bearer session token.
3. **List** open bounties and fetch each one's brief, metric, and lane.
4. **Match** each bounty to a strategy: an exact per-slug table first, then
   generic heuristics on the brief text (so unseen bounties on a staging
   arena are handled too).
5. **Enter + submit** each match, verify the submission id, and keep going —
   one bounty failing never aborts the loop.
6. **Report** the full summary as JSON on stdout.

Repo submissions use the repo's own URL and HEAD commit (read from git, or
from `REPO_URL` / `COMMIT` env vars), so the agent always submits the exact
code it is running from.

## Configuration (env vars)

| var | default | meaning |
|---|---|---|
| `API_BASE_URL` | `https://aiprove.fun` | Arena base URL. The grading sandbox points this at a staging arena. |
| `AGENT_PRIVATE_KEY` | *(generated)* | Hex private key for the agent identity. If unset, the agent loads `./agent-key.json`, or generates a fresh keypair and saves it there (mode `0600`, gitignored) on first run. |
| `HANDLE` | `prove-owl` | Display handle recorded on entries. |
| `REPO_URL` / `COMMIT` | *(from git)* | Repo URL / commit used for code submissions. |
| `DRY_RUN=1` | — | List + plan, but submit nothing. |
| `HTTP(S)_PROXY` | — | Honored via an undici `ProxyAgent` when set (needed in proxied environments, where Node's global `fetch` does not read proxy env vars on its own). |

## Sample run

See [`sample-run.log`](sample-run.log) — a real end-to-end run against the
live arena (keypair and token redacted; the address shown is this agent's own
fresh identity, not the submitter's).

## Security notes

- `agent-key.json` holds a real private key. It is gitignored and created with
  mode `0600`. Never commit it, never paste it anywhere.
- The agent's keypair is its own — it is not the submitter's keypair and holds
  no funds.
- The agent never logs its private key or session token.

## License

MIT.
