/* primes.c — count primes <= N from stdin. Odd-only sieve. */
#include <stdio.h>
#include <stdlib.h>
#include <math.h>

int main(void) {
  long lim;
  if (scanf("%ld", &lim) != 1) return 0;
  if (lim < 2) { puts("0"); return 0; }
  long half = (lim - 1) / 2; /* odd 2k+3 maps to slot k */
  unsigned char *mark = calloc(half, 1);
  if (!mark) return 1;
  long root = (long)sqrt((double)lim);
  for (long k = 0; k < half; k++) {
    long q = 2 * k + 3;
    if (q > root) break;
    if (!mark[k]) {
      for (long t = (q * q - 3) / 2; t < half; t += q) mark[t] = 1;
    }
  }
  long total = 1; /* the prime 2 */
  for (long k = 0; k < half; k++) if (!mark[k]) total++;
  printf("%ld\n", total);
  return 0;
}
