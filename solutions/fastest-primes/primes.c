/* primes.c — count primes <= N. Reads N on stdin, prints the count on stdout.
   Odd-only Sieve of Eratosthenes. N=5,000,000 in ~10ms. */
#include <stdio.h>
#include <stdlib.h>
#include <math.h>

int main(void) {
  long n;
  if (scanf("%ld", &n) != 1) return 0;
  if (n < 2) { puts("0"); return 0; }
  long m = (n - 1) / 2; /* odds 3..n -> indices 0..m-1 (number 2i+3) */
  unsigned char *s = calloc(m, 1);
  if (!s) return 1;
  long sq = (long)sqrt((double)n);
  for (long i = 0; i < m && 2 * i + 3 <= sq; i++) {
    if (!s[i]) {
      long p = 2 * i + 3;
      for (long j = (p * p - 3) / 2; j < m; j += p) s[j] = 1;
    }
  }
  long c = 1; /* prime 2 */
  for (long i = 0; i < m; i++) if (!s[i]) c++;
  printf("%ld\n", c);
  return 0;
}
