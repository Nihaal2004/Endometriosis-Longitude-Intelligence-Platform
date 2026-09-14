/**
 * stats.ts — Deterministic statistical primitives.
 *
 * Every test used by the pattern engine lives here. Two rules govern this file:
 *
 *   1. Pure functions only. No I/O, no dates, no randomness except where a seeded
 *      PRNG is passed in explicitly (permutationTest). The same inputs always
 *      produce the same outputs, which is what makes the clinician brief auditable.
 *
 *   2. Non-parametric / exact methods are preferred throughout. Symptom data here is
 *      ordinal (0-10 severity), counts are small (2-6 cycles), and distributions are
 *      skewed and zero-inflated. Normal-theory tests (t-test, Pearson r) are not
 *      appropriate for this data and are deliberately absent.
 *
 * Reference values for each function are asserted in stats.test.ts.
 */

// ---------------------------------------------------------------------------
// Special functions
// ---------------------------------------------------------------------------

const LANCZOS_G = 7
const LANCZOS_C = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
]

/** Log of the gamma function. Lanczos approximation, |rel. error| < 1e-13. */
export function logGamma(x: number): number {
  if (x < 0.5) {
    // Reflection formula: Γ(x)Γ(1-x) = π / sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  }
  const z = x - 1
  let a = LANCZOS_C[0]
  const t = z + LANCZOS_G + 0.5
  for (let i = 1; i < LANCZOS_G + 2; i++) a += LANCZOS_C[i] / (z + i)
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a)
}

/** log(n!) */
export function logFactorial(n: number): number {
  return logGamma(n + 1)
}

/** log of the binomial coefficient C(n, k). */
export function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k)
}

/**
 * Error function. Abramowitz & Stegun 7.1.26 is only ~1e-7 accurate, which is not
 * enough when we compare p-values against a 0.05 threshold near the boundary, so
 * this uses the higher-precision rational Chebyshev form (|error| < 1.2e-7 relative,
 * full double precision in the tails via the complementary form).
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const z = Math.abs(x)
  // Numerical Recipes erfc approximation, fractional error < 1.2e-7
  const t = 2 / (2 + z)
  const ty = 4 * t - 2
  const cof = [
    -1.3026537197817094, 6.4196979235649026e-1, 1.9476473204185836e-2,
    -9.561514786808631e-3, -9.46595344482036e-4, 3.66839497852761e-4,
    4.2523324806907e-5, -2.0278578112534e-5, -1.624290004647e-6,
    1.303655835580e-6, 1.5626441722e-8, -8.5238095915e-8, 6.529054439e-9,
    5.059343495e-9, -9.91364156e-10, -2.27365122e-10, 9.6467911e-11,
    2.394038e-12, -6.886027e-12, 8.94487e-13, 3.13092e-13, -1.12708e-13,
    3.81e-16, 7.106e-15,
  ]
  let d = 0
  let dd = 0
  for (let j = cof.length - 1; j > 0; j--) {
    const tmp = d
    d = ty * d - dd + cof[j]
    dd = tmp
  }
  const erfc = t * Math.exp(-z * z + 0.5 * (cof[0] + ty * d) - dd)
  return sign * (1 - erfc)
}

/** Standard normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

// ---------------------------------------------------------------------------
// Fisher's exact test — primary cyclicity test
// ---------------------------------------------------------------------------

export interface FisherResult {
  /** Two-sided p-value (sum of all tables no more likely than the observed one). */
  pTwoSided: number
  /** One-sided p-value, testing for enrichment in the first row. */
  pGreater: number
  /** Conditional (hypergeometric) probability of the observed table itself. */
  pObserved: number
}

/**
 * Fisher's exact test on a 2x2 contingency table.
 *
 *          | outcome+ | outcome- |
 *   group1 |    a     |    b     |
 *   group2 |    c     |    d     |
 *
 * Chosen over chi-square because our tables routinely contain expected cell counts
 * below 5 (a 3-cycle window has ~11 menstrual-window days), where the chi-square
 * approximation is invalid. The two-sided p-value uses the "sum of all tables with
 * probability <= that of the observed table" convention, which is what R's
 * fisher.test() reports for 2x2 tables.
 */
export function fisherExact(a: number, b: number, c: number, d: number): FisherResult {
  const row1 = a + b
  const row2 = c + d
  const col1 = a + c
  const n = row1 + row2

  if (n === 0 || row1 === 0 || row2 === 0 || col1 === 0 || col1 === n) {
    return { pTwoSided: 1, pGreater: 1, pObserved: 1 }
  }

  // Hypergeometric probability of a table with the given top-left cell, holding
  // all margins fixed.
  const logPk = (k: number) =>
    logChoose(row1, k) + logChoose(row2, col1 - k) - logChoose(n, col1)

  const kMin = Math.max(0, col1 - row2)
  const kMax = Math.min(row1, col1)

  const pObserved = Math.exp(logPk(a))
  // Relative tolerance guards against floating-point ties being dropped from the
  // two-sided sum, which would understate the p-value.
  const tol = 1e-9

  let pTwoSided = 0
  let pGreater = 0
  for (let k = kMin; k <= kMax; k++) {
    const pk = Math.exp(logPk(k))
    if (pk <= pObserved * (1 + tol)) pTwoSided += pk
    if (k >= a) pGreater += pk
  }

  return {
    pTwoSided: Math.min(1, pTwoSided),
    pGreater: Math.min(1, pGreater),
    pObserved,
  }
}

// ---------------------------------------------------------------------------
// Proportions
// ---------------------------------------------------------------------------

export interface Interval {
  low: number
  high: number
}

/**
 * Wilson score interval for a binomial proportion.
 *
 * Chosen over the Wald (normal-approximation) interval because our proportions are
 * frequently near 0 or 1 with small n, where Wald produces intervals that fall
 * outside [0,1] and have badly degraded coverage. Wilson stays in range and holds
 * nominal coverage at small n.
 */
export function wilsonInterval(k: number, n: number, z = 1.959963984540054): Interval {
  if (n === 0) return { low: 0, high: 1 }
  const p = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const centre = p + z2 / (2 * n)
  const halfWidth = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))

  // At k=0 and k=n the Wilson bounds are exactly 0 and 1 respectively. The algebra
  // above reaches those values only to within floating-point error (e.g. 1 - 1e-16),
  // so pin the exact endpoints rather than let rounding leak into a reported CI.
  const low = k === 0 ? 0 : Math.max(0, (centre - halfWidth) / denom)
  const high = k === n ? 1 : Math.min(1, (centre + halfWidth) / denom)
  return { low, high }
}

/**
 * Risk ratio with a log-transformed (Katz) 95% confidence interval.
 * Haldane-Anscombe correction (+0.5 to every cell) is applied only when a zero cell
 * would otherwise make the ratio or its variance undefined.
 */
export function riskRatio(
  exposedCases: number,
  exposedTotal: number,
  unexposedCases: number,
  unexposedTotal: number,
  z = 1.959963984540054,
): { rr: number; ci: Interval; corrected: boolean } {
  let a = exposedCases
  let n1 = exposedTotal
  let c = unexposedCases
  let n2 = unexposedTotal
  let corrected = false

  if (a === 0 || c === 0 || a === n1 || c === n2) {
    a += 0.5
    c += 0.5
    n1 += 1
    n2 += 1
    corrected = true
  }

  const r1 = a / n1
  const r2 = c / n2
  const rr = r1 / r2
  const se = Math.sqrt(1 / a - 1 / n1 + 1 / c - 1 / n2)
  const logRr = Math.log(rr)
  return {
    rr,
    ci: { low: Math.exp(logRr - z * se), high: Math.exp(logRr + z * se) },
    corrected,
  }
}

// ---------------------------------------------------------------------------
// Circular statistics — secondary cyclicity test
// ---------------------------------------------------------------------------

export interface CircularSummary {
  /** Mean resultant length R-bar in [0,1]. 0 = uniform, 1 = perfectly concentrated. */
  rBar: number
  /** Mean direction in radians, in [0, 2π). */
  meanAngle: number
  n: number
}

/** Mean direction and resultant length of a set of angles (radians). */
export function circularMean(angles: number[]): CircularSummary {
  const n = angles.length
  if (n === 0) return { rBar: 0, meanAngle: 0, n: 0 }
  let sumSin = 0
  let sumCos = 0
  for (const a of angles) {
    sumSin += Math.sin(a)
    sumCos += Math.cos(a)
  }
  const rBar = Math.sqrt(sumSin * sumSin + sumCos * sumCos) / n
  let meanAngle = Math.atan2(sumSin / n, sumCos / n)
  if (meanAngle < 0) meanAngle += 2 * Math.PI
  return { rBar, meanAngle, n }
}

export interface RayleighResult extends CircularSummary {
  /** Rayleigh z = n * R-bar^2 */
  z: number
  p: number
}

/**
 * Rayleigh test of uniformity on the circle.
 *
 * Null hypothesis: symptom occurrences are uniformly distributed around the cycle.
 * Rejecting it means occurrences cluster at some phase. This is the natural test for
 * "is this symptom cyclical?" because it operates on the cycle as a circle, so it has
 * no arbitrary window boundary — it complements Fisher's exact, which needs one.
 *
 * p-value uses Zar's second-order approximation, accurate for n >= 10 and
 * conservative below that.
 */
export function rayleighTest(angles: number[]): RayleighResult {
  const summary = circularMean(angles)
  const n = summary.n
  if (n < 2) return { ...summary, z: 0, p: 1 }

  const z = n * summary.rBar * summary.rBar
  // Zar (1999), Biostatistical Analysis, eq. 27.4
  const p =
    Math.exp(-z) *
    (1 +
      (2 * z - z * z) / (4 * n) -
      (24 * z - 132 * z * z + 76 * z * z * z - 9 * z * z * z * z) /
        (288 * n * n))

  return { ...summary, z, p: Math.min(1, Math.max(0, p)) }
}

// ---------------------------------------------------------------------------
// Trend — Mann-Kendall + Theil-Sen
// ---------------------------------------------------------------------------

export interface MannKendallResult {
  /** Kendall's S statistic. */
  s: number
  varS: number
  z: number
  p: number
  n: number
}

/**
 * Mann-Kendall test for monotonic trend, with the standard tie correction and
 * continuity correction.
 *
 * Chosen over linear regression because it is rank-based: it makes no assumption of
 * normality or of a *linear* trend, only a monotonic one, and it is not dragged by a
 * single extreme cycle. That matters when we have 3-6 per-cycle rates.
 */
export function mannKendall(series: number[]): MannKendallResult {
  const n = series.length
  if (n < 3) return { s: 0, varS: 0, z: 0, p: 1, n }

  let s = 0
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      s += Math.sign(series[j] - series[i])
    }
  }

  // Variance with correction for tied groups.
  const counts = new Map<number, number>()
  for (const v of series) counts.set(v, (counts.get(v) ?? 0) + 1)
  let tieTerm = 0
  for (const t of counts.values()) {
    if (t > 1) tieTerm += t * (t - 1) * (2 * t + 5)
  }
  const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18

  if (varS <= 0) return { s, varS, z: 0, p: 1, n }

  // Continuity correction: S moves toward zero by 1 before standardising.
  let z = 0
  if (s > 0) z = (s - 1) / Math.sqrt(varS)
  else if (s < 0) z = (s + 1) / Math.sqrt(varS)

  const p = 2 * (1 - normalCdf(Math.abs(z)))
  return { s, varS, z, p: Math.min(1, p), n }
}

/**
 * Theil-Sen slope estimator: the median of all pairwise slopes.
 * Reported alongside Mann-Kendall to give the trend a magnitude and unit. Robust to
 * up to ~29% outliers, unlike least squares.
 */
export function theilSen(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length)
  const slopes: number[] = []
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = x[j] - x[i]
      if (dx !== 0) slopes.push((y[j] - y[i]) / dx)
    }
  }
  return median(slopes)
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return NaN
  const s = [...values].sort((a, b) => a - b)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return s[lo]
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

// ---------------------------------------------------------------------------
// Agreement / co-occurrence
// ---------------------------------------------------------------------------

/**
 * Cohen's kappa for two binary raters (here: two symptoms co-occurring on a day).
 *
 * Preferred over a raw co-occurrence count or Jaccard alone because it corrects for
 * agreement expected by chance. Two symptoms that each occur on 80% of days will
 * co-occur on ~64% of days for no reason at all; kappa removes that floor.
 */
export function cohensKappa(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d
  if (n === 0) return 0
  const po = (a + d) / n
  const pe = ((a + b) * (a + c) + (c + d) * (b + d)) / (n * n)
  if (pe === 1) return 0
  return (po - pe) / (1 - pe)
}

/** Jaccard index — reported alongside kappa because clinicians read it more easily. */
export function jaccard(a: number, b: number, c: number): number {
  const denom = a + b + c
  return denom === 0 ? 0 : a / denom
}

// ---------------------------------------------------------------------------
// Poisson rate comparison — personal baseline change
// ---------------------------------------------------------------------------

/**
 * Two-sided exact binomial test: k successes out of n, under null probability p0.
 * Uses the "sum of all outcomes no more likely than the observed" convention.
 */
export function binomTest(k: number, n: number, p0 = 0.5): number {
  if (n === 0) return 1
  const logP = (i: number) =>
    logChoose(n, i) + i * Math.log(p0) + (n - i) * Math.log(1 - p0)

  // Guard the degenerate p0 endpoints.
  if (p0 <= 0) return k === 0 ? 1 : 0
  if (p0 >= 1) return k === n ? 1 : 0

  const pObs = Math.exp(logP(k))
  const tol = 1e-9
  let p = 0
  for (let i = 0; i <= n; i++) {
    const pi = Math.exp(logP(i))
    if (pi <= pObs * (1 + tol)) p += pi
  }
  return Math.min(1, p)
}

export interface RateComparison {
  rate1: number
  rate2: number
  rateRatio: number
  p: number
}

/**
 * Compare two Poisson rates (k1 events in t1 days vs k2 events in t2 days).
 *
 * Uses the exact conditional test: given the total k1+k2, the count k1 is binomial
 * with probability t1/(t1+t2). This is exact at the small counts we actually have
 * (a single cycle may contribute 2-8 events), where a normal-approximation
 * two-sample Poisson test is unreliable.
 */
export function poissonRateTest(
  k1: number,
  t1: number,
  k2: number,
  t2: number,
): RateComparison {
  const rate1 = t1 > 0 ? k1 / t1 : 0
  const rate2 = t2 > 0 ? k2 / t2 : 0
  const total = k1 + k2
  if (total === 0 || t1 <= 0 || t2 <= 0) {
    return { rate1, rate2, rateRatio: NaN, p: 1 }
  }
  const p0 = t1 / (t1 + t2)
  return {
    rate1,
    rate2,
    rateRatio: rate2 > 0 ? rate1 / rate2 : Infinity,
    p: binomTest(k1, total, p0),
  }
}

// ---------------------------------------------------------------------------
// Multiplicity control
// ---------------------------------------------------------------------------

/**
 * Benjamini-Hochberg step-up procedure. Returns q-values (adjusted p-values) in the
 * original input order.
 *
 * Necessary because the engine runs one test per (symptom x pattern class) — on the
 * order of 20-40 tests per patient. At alpha = 0.05 uncorrected, we would expect 1-2
 * false findings in every brief. FDR is the right family here rather than Bonferroni:
 * we are screening for findings worth a clinician's attention, not confirming a single
 * pre-registered hypothesis, so controlling the expected *proportion* of false
 * findings preserves power that Bonferroni would throw away.
 */
export function benjaminiHochberg(pValues: number[]): number[] {
  const n = pValues.length
  if (n === 0) return []

  const indexed = pValues.map((p, i) => ({ p, i }))
  indexed.sort((x, y) => x.p - y.p)

  const q = new Array<number>(n)
  let running = 1
  // Walk from the largest p downward, enforcing monotonicity.
  for (let rank = n; rank >= 1; rank--) {
    const { p, i } = indexed[rank - 1]
    running = Math.min(running, (p * n) / rank)
    q[i] = Math.min(1, running)
  }
  return q
}

// ---------------------------------------------------------------------------
// Permutation testing
// ---------------------------------------------------------------------------

/**
 * Generic two-sided permutation test.
 *
 * `statistic` is computed on the observed pairing, then on `iterations` shuffles of
 * `labels`. The p-value is the proportion of shuffles reaching at least the observed
 * magnitude, with the standard +1 correction in numerator and denominator so that a
 * p-value of exactly 0 is never reported.
 *
 * Used for co-occurrence, where the null distribution of kappa under the observed
 * marginals has no convenient closed form and the day-level data are not independent.
 */
export function permutationTest(
  labels: number[],
  values: number[],
  statistic: (labels: number[], values: number[]) => number,
  iterations: number,
  nextRandom: () => number,
): { observed: number; p: number; iterations: number } {
  const observed = statistic(labels, values)
  const shuffled = [...labels]
  let atLeastAsExtreme = 0

  for (let iter = 0; iter < iterations; iter++) {
    // Fisher-Yates using the injected PRNG, so results are reproducible by seed.
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(nextRandom() * (i + 1))
      const tmp = shuffled[i]
      shuffled[i] = shuffled[j]
      shuffled[j] = tmp
    }
    if (Math.abs(statistic(shuffled, values)) >= Math.abs(observed)) {
      atLeastAsExtreme++
    }
  }

  return {
    observed,
    p: (atLeastAsExtreme + 1) / (iterations + 1),
    iterations,
  }
}

// ---------------------------------------------------------------------------
// Classification metrics (used by the evaluation harness)
// ---------------------------------------------------------------------------

export interface ConfusionMatrix {
  tp: number
  fp: number
  tn: number
  fn: number
}

export interface ClassificationMetrics extends ConfusionMatrix {
  precision: number
  recall: number
  specificity: number
  f1: number
  /** Matthews correlation coefficient — reported because it stays honest under class imbalance. */
  mcc: number
  accuracy: number
  n: number
}

export function classificationMetrics(cm: ConfusionMatrix): ClassificationMetrics {
  const { tp, fp, tn, fn } = cm
  const n = tp + fp + tn + fn
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const specificity = tn + fp > 0 ? tn / (tn + fp) : 0
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
  const mccDenom = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))
  const mcc = mccDenom > 0 ? (tp * tn - fp * fn) / mccDenom : 0
  return {
    ...cm,
    precision,
    recall,
    specificity,
    f1,
    mcc,
    accuracy: n > 0 ? (tp + tn) / n : 0,
    n,
  }
}
