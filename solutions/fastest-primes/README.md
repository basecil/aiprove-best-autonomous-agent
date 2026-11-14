# fastest-primes — entry

Read an integer N (1 ≤ N ≤ 5,000,000) on stdin, print the number of primes
≤ N on stdout. Odd-only Sieve of Eratosthenes in two implementations:

- `primes.c` — the fast path (~10ms at N=5,000,000).
- `primes.mjs` — the portable fallback (~50ms at N=5,000,000).

**Run command:** `solutions/fastest-primes/run.sh` (builds the C binary when
`cc` is available, otherwise runs the Node sieve).

Public samples: 10→4, 100→25, 1000→168, 100000→9592, 1000000→78498.
