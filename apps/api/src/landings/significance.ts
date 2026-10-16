/**
 * AB7 (AX20) — A/B significance for landing variants.
 *
 * Pure, deterministic statistics — a classic two-proportion
 * z-test. No ML, no Bayesian machinery, no invented priors.
 *
 * twoProportionZTest(x1, n1, x2, n2):
 *   p1 = x1/n1, p2 = x2/n2
 *   pooled p = (x1 + x2) / (n1 + n2)
 *   SE = sqrt( p·(1−p)·(1/n1 + 1/n2) )          (pooled SE)
 *   z  = (p1 − p2) / SE
 *   pValue = 2 · (1 − Φ(|z|))                   (two-sided)
 *
 * Φ (the standard normal CDF) uses the Abramowitz–Stegun
 * 26.2.17 approximation (|ε(x)| ≤ 7.5e−8):
 *   for x ≥ 0,  Q(x) = φ(x)·(b1·t + b2·t² + b3·t³ + b4·t⁴ + b5·t⁵),
 *   t = 1 / (1 + 0.2316419·x), φ = the standard normal pdf,
 *   Φ(x) = 1 − Q(x); Φ(−x) = Q(x) by symmetry.
 *
 * Edge cases (honest, never a fabricated significance):
 *  - either n is 0, the pooled rate is 0 or 1, or the SE is 0
 *    (zero variance — e.g. both rates equal at an extreme):
 *    z = 0 and pValue = 1. When the rates are equal there is
 *    literally no observed difference to test; when a sample
 *    is empty there is nothing to test at all.
 */

/** Conversion rate as a fraction (0..1), rounded to 4 decimals.
 *  n = 0 ⇒ 0 (no views means no observed conversions either;
 *  callers that need "unknown" check n themselves). */
export function conversionRate(x: number, n: number): number {
  if (!n || n <= 0) return 0;
  return Math.round((x / n) * 10000) / 10000;
}

const AS_P = 0.2316419;
const AS_B = [0.31938153, -0.356563782, 1.781477937, -1.821255978, 1.330274429];

/** Standard normal CDF Φ(z), Abramowitz–Stegun 26.2.17. */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z);
  const t = 1 / (1 + AS_P * x);
  const poly =
    t * (AS_B[0] + t * (AS_B[1] + t * (AS_B[2] + t * (AS_B[3] + t * AS_B[4]))));
  const pdf = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const q = pdf * poly; // upper tail Q(x) for x ≥ 0
  return sign >= 0 ? 1 - q : q;
}

export function twoProportionZTest(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
): { z: number; pValue: number } {
  if (!n1 || !n2 || n1 <= 0 || n2 <= 0) return { z: 0, pValue: 1 };
  const pooled = (x1 + x2) / (n1 + n2);
  if (pooled <= 0 || pooled >= 1) return { z: 0, pValue: 1 };
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (!(se > 0)) return { z: 0, pValue: 1 };
  const z = (x1 / n1 - x2 / n2) / se;
  // Exactly equal rates => p is exactly 1 (the CDF approximation
  // alone would return 1 − ~1e-9 at z = 0).
  if (z === 0) return { z: 0, pValue: 1 };
  const pValue = Math.min(1, Math.max(0, 2 * (1 - normalCdf(Math.abs(z)))));
  return { z, pValue };
}
