// aiprove-best-autonomous-agent — a fully autonomous agent for the AIProve
// bounty board (aiprove.fun). No human in the loop:
//
//   1. Read skill.md from the arena and confirm the auth/bounty endpoints.
//   2. Authenticate with its own keypair (EIP-191 challenge -> sign -> session).
//   3. List open bounties and fetch each one's brief.
//   4. For EVERY bounty it can complete autonomously, enter and submit:
//      - forecast bounties   -> live price data + momentum/persistence rules
//      - code bounties       -> shipped solutions (solutions/)
//      - bug hunts           -> verified bug reports (knowledge/)
//      - article/art bounties -> shipped content (content/)
//      - anything needing X, video, referrals, or a stake -> skipped, with reason.
//   5. Print a JSON summary of completed / skipped / failed and exit 0.
//
// The agent never logs its private key or session token. Re-runs are
// idempotent: bounties already submitted are detected and skipped.
//
// Config (env):
//   API_BASE_URL       Arena base URL. Default: https://aiprove.fun
//                      (the grading sandbox points this at a staging arena)
//   AGENT_PRIVATE_KEY  Optional hex private key. If unset, the agent loads
//                      ./agent-key.json, or generates a fresh keypair and
//                      saves it there (mode 0600, gitignored) on first run.
//   HANDLE             Display handle for entries. Default: prove-owl.
//   REPO_URL / COMMIT  Override the repo URL / commit used for code
//                      submissions. Default: read from git (remote + HEAD).
//   HTTP(S)_PROXY      Honored via undici ProxyAgent when set.
//   DRY_RUN=1          List + plan, but submit nothing (for testing).

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Wallet } from "ethers";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = (process.env.API_BASE_URL || "https://aiprove.fun").replace(/\/$/, "");
const KEY_FILE = path.join(HERE, "agent-key.json");
const HANDLE = process.env.HANDLE || "prove-owl";
const DRY_RUN = process.env.DRY_RUN === "1";
const SELF_SLUG = "best-autonomous-agent";

// Baked fallback prices (Nov 2026, last known) — used only if live price
// fetches fail, so a forecast is still a real number, not a crash.
const FALLBACK_PRICE = { BTC: 65080, ETH: 1814.73, NVDA: 162.85, GLD: 355.45, SPY: 754.37 };

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy ||
                 process.env.HTTP_PROXY || process.env.http_proxy;
if (proxyUrl) {
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

const log = (step, msg) => console.log(`[${step}] ${msg}`);
const fail = (msg) => { console.error(`[error] ${msg}`); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, token, timeoutMs = 30000) {
  const res = await fetch(url, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "user-agent": "aiprove-best-autonomous-agent/1.0",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

async function postJSON(url, body, token, timeoutMs = 30000) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "aiprove-best-autonomous-agent/1.0",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`POST ${url} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  if (data && data.error) throw new Error(`POST ${url} -> ${data.error}`);
  return data;
}

// --- Price data (public, keyless) -----------------------------------------
async function coingeckoPrice(id) {
  const j = await getJSON(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`, null, 20000);
  const px = j?.[id]?.usd;
  if (typeof px !== "number") throw new Error(`no CoinGecko price for ${id}`);
  return px;
}

async function coingeckoMomentum(id, days) {
  const j = await getJSON(
    `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`, null, 20000);
  const prices = j?.prices;
  if (!Array.isArray(prices) || prices.length < 2) throw new Error(`no market chart for ${id}`);
  const first = prices[0][1], last = prices[prices.length - 1][1];
  return (last - first) / first;
}

async function stockPrice(symbol) {
  // Yahoo Finance chart API (works with a browser UA header).
  try {
    const j = await getJSON(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`, null, 20000);
    const px = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (typeof px === "number") return px;
  } catch { /* fall through */ }
  // Nasdaq public quote API.
  try {
    const j = await getJSON(
      `https://api.nasdaq.com/api/quote/${symbol}/info?assetclass=stocks`, null, 20000);
    const s = j?.data?.primaryData?.lastSalePrice;
    const px = typeof s === "string" ? parseFloat(s.replace(/[$,]/g, "")) : NaN;
    if (Number.isFinite(px)) return px;
  } catch { /* fall through */ }
  throw new Error(`no live price for ${symbol}`);
}

// 5-day momentum for a stock, from Yahoo Finance daily closes.
async function stockMomentum(symbol) {
  const j = await getJSON(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d`, null, 20000);
  const closes = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((x) => x != null);
  if (!Array.isArray(closes) || closes.length < 2) throw new Error(`no 5d history for ${symbol}`);
  return (closes[closes.length - 1] - closes[0]) / closes[0];
}

const CRYPTO_IDS = { BTC: "bitcoin", ETH: "ethereum" };
async function assetPrice(asset) {
  if (CRYPTO_IDS[asset]) return coingeckoPrice(CRYPTO_IDS[asset]);
  return stockPrice(asset);
}
async function assetMomentum(asset, days) {
  if (CRYPTO_IDS[asset]) return coingeckoMomentum(CRYPTO_IDS[asset], days);
  return stockMomentum(asset); // 5d window for stocks (Yahoo range=5d)
}

// --- Repo identity (for code submissions) ---------------------------------
function git(cmd) {
  try { return execSync(`git ${cmd}`, { cwd: HERE, encoding: "utf8" }).trim(); }
  catch { return ""; }
}
function repoIdentity() {
  let url = process.env.REPO_URL || "";
  if (!url) {
    url = git("config --get remote.origin.url");
    const m = url.match(/^git@github\.com:(.+?)(?:\.git)?$/);
    if (m) url = `https://github.com/${m[1]}`;
    url = url.replace(/\.git$/, "");
  }
  const commit = process.env.COMMIT || git("rev-parse HEAD");
  return { repoUrl: url, commit };
}

// --- Step 0: health -------------------------------------------------------
try {
  const health = await getJSON(`${API}/api/health`);
  log("health", `arena up: ${JSON.stringify(health).slice(0, 120)}`);
} catch (e) {
  log("health", `unavailable (${e.message}) — continuing, the loop will prove connectivity`);
}

// --- Step 1: read skill.md -----------------------------------------------
let skillMd;
try {
  const res = await fetch(`${API}/skill.md`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) fail(`could not read skill.md: HTTP ${res.status}`);
  skillMd = await res.text();
} catch (e) {
  fail(`could not read skill.md: ${e.message}`);
}
const endpoints = [...new Set([...skillMd.matchAll(/\/api\/[a-z0-9/:._-]+/gi)].map((m) => m[0]))];
if (!skillMd.includes("/api/auth/challenge") || !skillMd.includes("/api/bounties")) {
  fail("skill.md did not contain the expected auth/bounty endpoints");
}
log("skill.md", `read ${skillMd.length} bytes, ${endpoints.length} endpoints documented`);

// --- Step 2: keypair + authenticate --------------------------------------
let wallet;
if (process.env.AGENT_PRIVATE_KEY) {
  wallet = new Wallet(process.env.AGENT_PRIVATE_KEY);
  log("keypair", `loaded from AGENT_PRIVATE_KEY env (address ${wallet.address})`);
} else if (fs.existsSync(KEY_FILE)) {
  const saved = JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
  wallet = new Wallet(saved.privateKey);
  log("keypair", `loaded from agent-key.json (address ${wallet.address})`);
} else {
  wallet = Wallet.createRandom();
  fs.writeFileSync(KEY_FILE, JSON.stringify({ address: wallet.address, privateKey: wallet.privateKey }, null, 2), { mode: 0o600 });
  log("keypair", `generated fresh keypair, saved to agent-key.json (address ${wallet.address})`);
}

let token;
try {
  const { challenge } = await getJSON(`${API}/api/auth/challenge?address=${wallet.address}`);
  if (!challenge) fail("challenge endpoint returned no challenge");
  const signature = await wallet.signMessage(challenge); // EIP-191 personal_sign
  const verified = await postJSON(`${API}/api/auth/verify`, { address: wallet.address, signature });
  token = verified.token;
  if (!token) fail("verify endpoint returned no session token");
  log("auth", `authenticated as ${wallet.address} (session token received, not logged)`);
} catch (e) {
  fail(`authentication failed: ${e.message}`);
}

// --- Step 3: list open bounties + own submissions -------------------------
let bounties;
try {
  const list = await getJSON(`${API}/api/bounties?status=open`, token);
  bounties = list.bounties || list.items || list;
  if (!Array.isArray(bounties)) fail("bounty list response was not an array");
} catch (e) {
  fail(`listing bounties failed: ${e.message}`);
}
log("bounties", `${bounties.length} open bounties`);

let submittedSlugs = new Set();
try {
  const me = await getJSON(`${API}/api/me/submissions`, token);
  for (const s of (me.submissions || me.items || [])) submittedSlugs.add(s.bountySlug || s.slug);
  log("status", `${submittedSlugs.size} bounties already submitted by this agent`);
} catch (e) {
  log("status", `could not read own submissions (${e.message}) — will attempt all`);
}

const { repoUrl, commit } = repoIdentity();
if (repoUrl && commit) log("repo", `${repoUrl} @ ${commit.slice(0, 12)}`);
else log("repo", "could not determine repo/commit from git — repo submissions will fail cleanly");

// --- Step 4: strategies ---------------------------------------------------
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(HERE, p), "utf8"));
const bugReports = readJSON("knowledge/bug-hunt-utils.json");
const stakePoolTokens = readJSON("knowledge/bughunt-stakepool.json");

function repoSubmission(transcript) {
  if (!repoUrl || !commit) throw new Error("no repo identity available for a repo submission");
  return { repoUrl, commit, transcript, handle: HANDLE };
}

// PosterJudge ("link") bounties take a URL to the work + a note for the judge
// (the site's own submit form posts { link, note }). The link points at the
// file in this repo, pinned to the exact commit the agent is running from.
function linkSubmission(relPath, note) {
  if (!repoUrl || !commit) throw new Error("no repo identity available for a link submission");
  return { link: `${repoUrl}/blob/${commit}/${relPath}`, note, handle: HANDLE };
}

// Directional yes/no forecast from price momentum over `days`.
async function directionalForecast(asset, days, brief) {
  let mom = 0;
  try { mom = await assetMomentum(asset, days); } catch (e) { log("price", `${asset} momentum unavailable (${e.message}) — neutral`); }
  const asksLower = /lower|down|fall|drop|bear/i.test(brief || "");
  const up = mom > 0.005;
  const answer = asksLower ? (up ? "no" : "yes") : (up ? "yes" : "no");
  const confidence = Math.min(0.6, 0.53 + Math.min(Math.abs(mom) * 1.5, 0.07));
  return { prediction: { answer, confidence: +confidence.toFixed(2) }, handle: HANDLE };
}

// Single-number forecast: persistence (current price).
async function numericForecast(asset) {
  let px;
  try { px = await assetPrice(asset); }
  catch (e) {
    px = FALLBACK_PRICE[asset];
    log("price", `${asset} live price unavailable (${e.message}) — fallback ${px}`);
    if (px == null) throw new Error(`no price source for ${asset}`);
  }
  return { prediction: { answer: +px.toFixed(2) }, handle: HANDLE };
}

// Long/short signal from 24h momentum.
async function signalForecast(asset) {
  let mom = 0;
  try { mom = await assetMomentum(asset, 1); } catch { /* neutral */ }
  return {
    prediction: { answer: mom >= 0 ? "long" : "short", confidence: mom === 0 ? 0.5 : 0.56 },
    handle: HANDLE,
  };
}

// Signed percent-move forecast (e.g. an earnings reaction day). Direction
// follows recent momentum; magnitude is a conservative 2.5% — for absolute
// error scoring, the optimal point forecast is the median of the move
// distribution, and earnings-day medians sit well inside the fat tails.
async function percentMoveForecast(asset) {
  let mom = 0, haveMom = false;
  try { mom = await assetMomentum(asset, 5); haveMom = true; }
  catch (e) { log("price", `${asset} momentum unavailable (${e.message}) — slight-negative default`); }
  const pct = !haveMom ? -1.5 : mom >= 0 ? 2.5 : -2.5;
  return { prediction: { answer: pct }, handle: HANDLE };
}

// Fully-diluted market cap of $PROVE in ETH, 3 days after its pons
// fair-launch. No price feed exists pre-launch; 5 ETH is a central estimate:
// pons fair-launch FDVs for small project tokens cluster in low single-digit
// ETH, and the brief's own examples bracket 1.7–12.5 ETH.
function proveMarketCapForecast() {
  return { prediction: { answer: 5 }, handle: HANDLE };
}

// Per-slug strategy table (exact matches win over generic heuristics).
const STRATEGIES = {
  "code-golf-expr": () => repoSubmission(
    "Autonomous entry: single-file evalExpr (recursive-descent parser, no eval). See solutions/code-golf-expr/evalExpr.js; 20/20 public+edge cases pass."),
  "fastest-primes": () => repoSubmission(
    "Autonomous entry: odd-only sieve, C fast path + Node fallback. Run command: solutions/fastest-primes/run.sh (reads N on stdin, prints prime count)."),
  "eth-pnl-fixed": () => repoSubmission(
    "Autonomous entry: dual moving-average crossover MA(32)/MA(128) on the frozen ETH bars. See solutions/eth-backtest/strategy.mjs; backtest +$16.90/unit, 14 trades."),
  "write-article-aiprove": () => linkSubmission("content/article.md",
    "Honest explainer article about the AIProve board: how it works, what 'prove it' means, and the prototype caveats. Written by the autonomous agent itself."),
  "make-art-aiprove": () => linkSubmission("content/poster.svg",
    "Broadsheet-style AIProve poster (original SVG): masthead, 'Prove the Owl' mark, free-to-enter / graded-in-the-open / paid-in-stock."),
  "aiprove-mascot": () => linkSubmission("content/mascot.svg",
    "'Prove the Owl' — the AIProve mascot (original SVG): a flat geometric owl with a checkmark badge, broadsheet-meets-terminal colors."),
  "sample-agent-skillmd": () => repoSubmission(
    "Autonomous entry: this repo IS a sample agent — reads skill.md, authenticates with its own keypair, lists bounties, enters and completes them. See agent.mjs."),
  "bug-hunt-utils": () => ({
    // The bug-hunt API takes the report list as a JSON string.
    prediction: JSON.stringify(bugReports), handle: HANDLE,
  }),
  "bughunt-stakepool": () => ({
    // The audit API takes the finding tokens as one comma-separated string:
    // "function:class, function:class, ...". See knowledge/bughunt-stakepool.md.
    prediction: stakePoolTokens.join(", "), handle: HANDLE,
  }),
  "forecast-btc-7d": () => directionalForecast("BTC", 7, "will BTC close higher"),
  "forecast-nvda-3d": () => numericForecast("NVDA"),
  "nvda-jensen-earnings": () => percentMoveForecast("NVDA"),
  "prove-mc-3d": () => proveMarketCapForecast(),
};

// Generic fallback: infer the bounty type from its brief/metric.
function inferStrategy(b) {
  const text = `${b.slug} ${b.title || ""} ${b.brief || ""} ${b.metric || ""}`;
  const asset = /btc|bitcoin/i.test(text) ? "BTC"
    : /eth\b|ethereum/i.test(text) ? "ETH"
    : /nvda|nvidia/i.test(text) ? "NVDA"
    : /gold|gld/i.test(text) ? "GLD"
    : /spy|s&p/i.test(text) ? "SPY" : null;
  if (/top 5|five tokens/i.test(text)) return { skip: "needs live pons launch data" };
  if (/retweet|quote-tweet|quote tweet|follow @|post .* on x\b|tag \d+ agents/i.test(text)) return { skip: "needs an X account" };
  if (/\bvideo\b/i.test(text)) return { skip: "cannot produce video" };
  if (/\brefer/i.test(text)) return { skip: "referral-based, not completable alone" };
  if (/yes or no/i.test(text) && /probability/i.test(text) && asset) {
    const days = /7[- ]day|7d/i.test(text) ? 7 : /3[- ]day|3d/i.test(text) ? 3 : 1;
    return { run: () => directionalForecast(asset, days, b.brief || "") };
  }
  if (/single signed percent|signed percent/i.test(text) && asset) {
    return { run: () => percentMoveForecast(asset) };
  }
  if (/submit one number|one number|single number/i.test(text) && asset) {
    return { run: () => numericForecast(asset) };
  }
  if (/long or short|directional .* signal|signal.*long/i.test(text) && asset) {
    return { run: () => signalForecast(asset) };
  }
  if (b.lane === "PosterJudge" && /article/i.test(text)) {
    return { run: () => linkSubmission("content/article.md", "Explainer article about the AIProve board. See content/article.md.") };
  }
  if (/\b(mascot|poster|logo|art)\b/i.test(text)) {
    return { run: () => linkSubmission("content/poster.svg", "Original SVG art for AIProve. See content/.") };
  }
  return { skip: "no autonomous strategy for this bounty type" };
}

// --- Step 5: run the loop -------------------------------------------------
const results = { completed: [], alreadySubmitted: [], skipped: [], gated: [], failed: [] };

for (const b of bounties) {
  const slug = b.slug;
  if (slug === SELF_SLUG) { results.skipped.push({ slug, reason: "self bounty, skipped" }); continue; }
  if (submittedSlugs.has(slug)) {
    log("skip", `${slug}: already submitted by this agent`);
    results.alreadySubmitted.push(slug);
    continue;
  }

  // Fetch the full brief for strategy matching.
  let detail = b;
  try {
    const d = await getJSON(`${API}/api/bounties/${slug}`, token);
    if (d.bounty) detail = d.bounty;
  } catch (e) {
    log("detail", `${slug}: could not fetch detail (${e.message}) — using list data`);
  }

  // Stake-gated bounties (hold-to-play) cannot be entered without $PROVE.
  // NOTE: the `gated` flag on the bounty object is advisory only — it has
  // been observed to flip (it briefly read `true` for three PosterJudge
  // bounties that then accepted entries and submissions normally). The
  // authoritative gate is the enter call itself: a 403 PROVE error there is
  // ground truth, so the agent always attempts entry and lets the server
  // decide. See the enter-error handler below.
  if (detail.gated === true) {
    log("gated", `${slug}: bounty object flags gated — attempting entry anyway, the server decides`);
  }

  // Match a strategy BEFORE entering, so bounties the agent cannot complete
  // never get a noise entry.
  let plan;
  if (STRATEGIES[slug]) plan = { run: STRATEGIES[slug] };
  else plan = inferStrategy(detail);
  if (plan.skip) {
    log("skip", `${slug}: ${plan.skip}`);
    results.skipped.push({ slug, reason: plan.skip });
    continue;
  }

  // Enter (free; submitting auto-enters, but entering proves the loop).
  try {
    if (!DRY_RUN) await postJSON(`${API}/api/bounties/${slug}/enter`, { handle: HANDLE }, token);
    log("enter", `${slug}: entered`);
  } catch (e) {
    if (/PROVE|stake|credit/i.test(e.message)) {
      log("gated", `${slug}: entry requires a PROVE stake — skipped`);
      results.gated.push({ slug, reason: "stake-gated (100,000 PROVE)" });
      continue;
    }
    if (/already|duplicate/i.test(e.message)) {
      log("enter", `${slug}: already entered`);
    } else {
      log("enter", `${slug}: enter failed (${e.message}) — will still try to submit`);
    }
  }

  // Submit.
  try {
    const payload = await plan.run();
    if (DRY_RUN) {
      log("dry-run", `${slug}: would submit ${JSON.stringify(payload).slice(0, 200)}`);
      results.completed.push({ slug, dryRun: true });
      continue;
    }
    const sub = await postJSON(`${API}/api/bounties/${slug}/submit`, payload, token);
    log("submit", `${slug}: submitted (id ${sub.id || sub.submissionId || "n/a"})`);
    results.completed.push({ slug, id: sub.id || sub.submissionId || null });
  } catch (e) {
    if (/already submitted|duplicate/i.test(e.message)) {
      log("submit", `${slug}: already submitted`);
      results.alreadySubmitted.push(slug);
    } else {
      log("fail", `${slug}: submit failed — ${e.message}`);
      results.failed.push({ slug, reason: e.message.slice(0, 200) });
    }
  }
  await sleep(600); // be polite to the arena between writes
}

// --- Done -----------------------------------------------------------------
const summary = {
  loop: "complete",
  api: API,
  address: wallet.address,
  handle: HANDLE,
  dryRun: DRY_RUN,
  skillMdBytes: skillMd.length,
  skillMdEndpoints: endpoints.length,
  bountiesListed: bounties.length,
  completed: results.completed.length,
  alreadySubmitted: results.alreadySubmitted.length,
  skipped: results.skipped.length,
  gated: results.gated.length,
  failed: results.failed.length,
  detail: results,
};
console.log(JSON.stringify(summary, null, 2));
try { fs.writeFileSync(path.join(HERE, "run-summary.json"), JSON.stringify(summary, null, 2)); } catch { /* best effort */ }
console.log("LOOP COMPLETE");
