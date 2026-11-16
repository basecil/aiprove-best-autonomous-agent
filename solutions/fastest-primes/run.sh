#!/bin/sh
# fastest-primes runner: read N on stdin, print the count of primes <= N.
# Uses the compiled C sieve when cc exists, else the Node sieve.
cd "$(dirname "$0")"
if command -v cc >/dev/null 2>&1; then
  if [ ! -x primes ] || [ primes.c -nt primes ]; then
    cc -O3 -o primes primes.c -lm 2>/dev/null || true
  fi
  [ -x primes ] && exec ./primes
fi
exec node primes.mjs
