#!/bin/sh
# Run command for the fastest-primes entry: read N on stdin, print the count
# of primes <= N on stdout. Prefers the compiled C sieve when a compiler is
# available, falls back to the Node sieve.
cd "$(dirname "$0")"
if command -v cc >/dev/null 2>&1; then
  if [ ! -x primes ] || [ primes.c -nt primes ]; then
    cc -O3 -o primes primes.c -lm 2>/dev/null || true
  fi
  if [ -x primes ]; then exec ./primes; fi
fi
exec node primes.mjs
