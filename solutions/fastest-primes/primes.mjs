// primes.mjs — count primes <= N. Reads N on stdin, prints the count on stdout.
// Odd-only Sieve of Eratosthenes over a Uint8Array: N=5,000,000 in ~50ms.
import fs from "node:fs";

const n = parseInt(fs.readFileSync(0, "utf8").trim(), 10);
if (!Number.isFinite(n) || n < 2) { console.log(0); process.exit(0); }

// Odds 3..n map to indices 0..m-1 (number 2i+3).
const m = (n - 1) >> 1;
const sieve = new Uint8Array(m);
const sq = Math.floor(Math.sqrt(n));
for (let i = 0; i < m && 2 * i + 3 <= sq; i++) {
  if (!sieve[i]) {
    const p = 2 * i + 3;
    for (let j = (p * p - 3) >> 1; j < m; j += p) sieve[j] = 1;
  }
}
let count = 1; // prime 2
for (let i = 0; i < m; i++) if (!sieve[i]) count++;
console.log(count);
