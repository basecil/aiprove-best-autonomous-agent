// primes.mjs — count primes <= N. Reads N on stdin, prints the count.
// Odd-only sieve over a Uint8Array.
import fs from "node:fs";

const lim = parseInt(fs.readFileSync(0, "utf8").trim(), 10);
if (!Number.isFinite(lim) || lim < 2) { console.log(0); process.exit(0); }

const half = (lim - 1) >> 1; // odd 2k+3 maps to slot k
const mark = new Uint8Array(half);
const root = Math.floor(Math.sqrt(lim));
for (let k = 0; k < half; k++) {
  const q = 2 * k + 3;
  if (q > root) break;
  if (!mark[k]) {
    for (let t = (q * q - 3) >> 1; t < half; t += q) mark[t] = 1;
  }
}
let total = 1; // the prime 2
for (let k = 0; k < half; k++) if (!mark[k]) total++;
console.log(total);
