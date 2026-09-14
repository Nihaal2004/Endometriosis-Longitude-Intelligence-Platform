/**
 * stats.test.ts — Correctness gate for the statistical layer.
 *
 * Three kinds of assertion appear here, in decreasing order of authority:
 *
 *   1. PUBLISHED REFERENCE VALUES. Hand-checkable results from the standard worked
 *      examples (Fisher's tea-tasting experiment, the Wikipedia 2x2 diet example,
 *      Wilson's interval for 5/20). These anchor the implementation to values that
 *      can be verified against R or any textbook.
 *
 *   2. INDEPENDENT CROSS-CHECKS. The optimised implementation is compared against a
 *      naive brute-force implementation written separately inside the test.
 *
 *   3. INVARIANTS. Properties that must hold for any input (symmetry, monotonicity,
 *      range bounds).
 */

import { describe, expect, it } from 'vitest'
import {
  benjaminiHochberg,
  binomTest,
  circularMean,
  classificationMetrics,
  cohensKappa,
  erf,
  fisherExact,
  jaccard,
  logChoose,
  logFactorial,
  mannKendall,
  median,
  normalCdf,
  permutationTest,
  poissonRateTest,
  quantile,
  rayleighTest,
  riskRatio,
  theilSen,
  wilsonInterval,
} from './stats'
import { createRandom, mulberry32, sampleVonMises, vonMisesRelativeDensity } from './rng'

// ---------------------------------------------------------------------------
// Special functions
// ---------------------------------------------------------------------------

describe('special functions', () => {
  it('logFactorial matches exact values for small n', () => {
    expect(Math.exp(logFactorial(0))).toBeCloseTo(1, 10)
    expect(Math.exp(logFactorial(1))).toBeCloseTo(1, 10)
    expect(Math.exp(logFactorial(5))).toBeCloseTo(120, 8)
    expect(Math.exp(logFactorial(10))).toBeCloseTo(3628800, 4)
  })

  it('logChoose matches exact binomial coefficients', () => {
    expect(Math.exp(logChoose(8, 4))).toBeCloseTo(70, 8)
    expect(Math.exp(logChoose(24, 10))).toBeCloseTo(1961256, 2)
    expect(logChoose(5, 6)).toBe(-Infinity)
  })

  it('erf matches published values', () => {
    expect(erf(0)).toBeCloseTo(0, 12)
    expect(erf(0.5)).toBeCloseTo(0.5204998778, 8)
    expect(erf(1)).toBeCloseTo(0.8427007929, 8)
    expect(erf(2)).toBeCloseTo(0.9953222650, 8)
    expect(erf(-1)).toBeCloseTo(-0.8427007929, 8)
  })

  it('normalCdf matches standard normal table values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 10)
    expect(normalCdf(1.959963984540054)).toBeCloseTo(0.975, 7)
    expect(normalCdf(-1.6448536269514722)).toBeCloseTo(0.05, 7)
    expect(normalCdf(1)).toBeCloseTo(0.8413447461, 7)
    expect(normalCdf(3)).toBeCloseTo(0.9986501020, 7)
  })
})

// ---------------------------------------------------------------------------
// Fisher's exact test
// ---------------------------------------------------------------------------

describe("Fisher's exact test", () => {
  it("reproduces Fisher's tea-tasting experiment", () => {
    // 4 cups each way, 3 correctly identified. Classic published result:
    //   one-sided p = 17/70 = 0.242857, two-sided p = 34/70 = 0.485714
    const r = fisherExact(3, 1, 1, 3)
    expect(r.pGreater).toBeCloseTo(17 / 70, 10)
    expect(r.pGreater).toBeCloseTo(0.2428571429, 9)
    expect(r.pTwoSided).toBeCloseTo(34 / 70, 10)
    expect(r.pTwoSided).toBeCloseTo(0.4857142857, 9)
  })

  it('reproduces the standard 2x2 diet example', () => {
    // Men: 1 dieting / 11 not. Women: 9 dieting / 3 not.
    // The table is symmetric in its row margins (12/12), so the exact two-sided
    // p-value is twice the lower tail: 2 * (C(12,0)C(12,10) + C(12,1)C(12,9)) / C(24,10)
    //   = 2 * (66 + 2640) / 1961256 = 5412 / 1961256 = 0.00275945618...
    // which matches the commonly quoted 0.0027594.
    const r = fisherExact(1, 11, 9, 3)
    expect(r.pTwoSided).toBeCloseTo(5412 / 1961256, 12)
    expect(r.pTwoSided).toBeCloseTo(0.0027594, 6)
  })

  it('agrees with a brute-force enumeration on random tables', () => {
    // Independent, deliberately naive reimplementation.
    const bruteForce = (a: number, b: number, c: number, d: number) => {
      const row1 = a + b
      const row2 = c + d
      const col1 = a + c
      const n = row1 + row2
      const fact = (x: number) => {
        let f = 1
        for (let i = 2; i <= x; i++) f *= i
        return f
      }
      const prob = (k: number) => {
        const k2 = col1 - k
        if (k < 0 || k2 < 0 || k > row1 || k2 > row2) return 0
        return (
          (fact(row1) / (fact(k) * fact(row1 - k))) *
          (fact(row2) / (fact(k2) * fact(row2 - k2))) /
          (fact(n) / (fact(col1) * fact(n - col1)))
        )
      }
      const pObs = prob(a)
      let total = 0
      for (let k = 0; k <= Math.min(row1, col1); k++) {
        const p = prob(k)
        if (p > 0 && p <= pObs * (1 + 1e-9)) total += p
      }
      return Math.min(1, total)
    }

    const rand = mulberry32(20260914)
    for (let trial = 0; trial < 300; trial++) {
      const a = Math.floor(rand() * 12)
      const b = Math.floor(rand() * 12)
      const c = Math.floor(rand() * 12)
      const d = Math.floor(rand() * 12)
      if (a + b === 0 || c + d === 0 || a + c === 0 || b + d === 0) continue
      expect(fisherExact(a, b, c, d).pTwoSided).toBeCloseTo(bruteForce(a, b, c, d), 8)
    }
  })

  it('is symmetric under transposition and returns p=1 for degenerate tables', () => {
    expect(fisherExact(5, 3, 2, 6).pTwoSided).toBeCloseTo(
      fisherExact(5, 2, 3, 6).pTwoSided,
      12,
    )
    expect(fisherExact(0, 0, 0, 0).pTwoSided).toBe(1)
    expect(fisherExact(4, 0, 4, 0).pTwoSided).toBe(1) // no variation in outcome
  })

  it('detects a strong menstrual-window association of realistic size', () => {
    // 9 of 11 menstrual-window days vs 5 of 60 other days — the worked example from
    // the design document. Must be comfortably significant.
    const r = fisherExact(9, 2, 5, 55)
    expect(r.pTwoSided).toBeLessThan(0.001)
  })
})

// ---------------------------------------------------------------------------
// Proportions and effect sizes
// ---------------------------------------------------------------------------

describe('proportion intervals', () => {
  it('reproduces the published Wilson interval for 5/20', () => {
    const ci = wilsonInterval(5, 20)
    expect(ci.low).toBeCloseTo(0.1118, 3)
    expect(ci.high).toBeCloseTo(0.4687, 3)
  })

  it('stays inside [0,1] at the boundaries where Wald would not', () => {
    const atZero = wilsonInterval(0, 10)
    expect(atZero.low).toBe(0)
    expect(atZero.high).toBeGreaterThan(0)
    expect(atZero.high).toBeLessThan(1)

    const atOne = wilsonInterval(10, 10)
    expect(atOne.high).toBe(1)
    expect(atOne.low).toBeGreaterThan(0)
    expect(atOne.low).toBeLessThan(1)
  })

  it('narrows as n grows for a fixed proportion', () => {
    const small = wilsonInterval(5, 10)
    const large = wilsonInterval(50, 100)
    expect(large.high - large.low).toBeLessThan(small.high - small.low)
  })

  it('computes risk ratio with a log-transformed interval', () => {
    // 9/11 vs 5/60 -> RR = 0.8182 / 0.08333 = 9.818
    const r = riskRatio(9, 11, 5, 60)
    expect(r.rr).toBeCloseTo(9.818, 2)
    expect(r.corrected).toBe(false)
    expect(r.ci.low).toBeLessThan(r.rr)
    expect(r.ci.high).toBeGreaterThan(r.rr)
    expect(r.ci.low).toBeGreaterThan(1) // interval excludes the null
  })

  it('applies the Haldane-Anscombe correction only when a cell is zero', () => {
    expect(riskRatio(0, 10, 5, 50).corrected).toBe(true)
    expect(Number.isFinite(riskRatio(0, 10, 5, 50).rr)).toBe(true)
    expect(riskRatio(3, 10, 5, 50).corrected).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Circular statistics
// ---------------------------------------------------------------------------

describe('circular statistics', () => {
  it('computes the mean direction of two orthogonal angles', () => {
    const r = circularMean([0, Math.PI / 2])
    expect(r.meanAngle).toBeCloseTo(Math.PI / 4, 10)
    expect(r.rBar).toBeCloseTo(Math.SQRT2 / 2, 10)
  })

  it('handles wraparound across 0 correctly', () => {
    // Angles either side of zero must average to ~0, not to pi.
    const r = circularMean([0.1, 2 * Math.PI - 0.1])
    expect(Math.min(r.meanAngle, 2 * Math.PI - r.meanAngle)).toBeCloseTo(0, 8)
    expect(r.rBar).toBeGreaterThan(0.99)
  })

  it('gives rBar near zero for evenly spaced angles', () => {
    const angles = Array.from({ length: 36 }, (_, i) => (i * 2 * Math.PI) / 36)
    expect(circularMean(angles).rBar).toBeCloseTo(0, 8)
  })

  it('Rayleigh test does not reject uniformity for uniform data', () => {
    const rand = mulberry32(7)
    const angles = Array.from({ length: 60 }, () => rand() * 2 * Math.PI)
    const r = rayleighTest(angles)
    expect(r.p).toBeGreaterThan(0.05)
    expect(r.rBar).toBeLessThan(0.3)
  })

  it('Rayleigh test rejects uniformity for concentrated data', () => {
    const next = mulberry32(11)
    const angles = Array.from({ length: 60 }, () => sampleVonMises(1.0, 4, next))
    const r = rayleighTest(angles)
    expect(r.p).toBeLessThan(0.001)
    expect(r.rBar).toBeGreaterThan(0.6)
    expect(r.meanAngle).toBeCloseTo(1.0, 0) // recovers the generating phase
  })

  it('satisfies the identity z = n * rBar^2', () => {
    const next = mulberry32(3)
    const angles = Array.from({ length: 25 }, () => sampleVonMises(2.0, 2, next))
    const r = rayleighTest(angles)
    expect(r.z).toBeCloseTo(r.n * r.rBar * r.rBar, 12)
  })

  it('p-value decreases monotonically with concentration', () => {
    const ps = [0.5, 1, 2, 4, 8].map((kappa) => {
      const next = mulberry32(99)
      const angles = Array.from({ length: 50 }, () => sampleVonMises(0, kappa, next))
      return rayleighTest(angles).p
    })
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeLessThanOrEqual(ps[i - 1])
  })
})

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

describe('trend detection', () => {
  it('computes S and p for a strictly increasing series', () => {
    // n=5 increasing: S = C(5,2) = 10, varS = 5*4*15/18 = 16.667
    const r = mannKendall([1, 2, 3, 4, 5])
    expect(r.s).toBe(10)
    expect(r.varS).toBeCloseTo(300 / 18, 10)
    expect(r.z).toBeCloseTo(9 / Math.sqrt(300 / 18), 10)
    expect(r.p).toBeLessThan(0.05)
  })

  it('is sign-symmetric for a decreasing series', () => {
    const up = mannKendall([1, 2, 3, 4, 5])
    const down = mannKendall([5, 4, 3, 2, 1])
    expect(down.s).toBe(-up.s)
    expect(down.p).toBeCloseTo(up.p, 12)
  })

  it('finds no trend in a flat or non-monotonic series', () => {
    expect(mannKendall([3, 3, 3, 3, 3]).s).toBe(0)
    expect(mannKendall([3, 3, 3, 3, 3]).p).toBe(1)
    expect(mannKendall([1, 5, 2, 4, 3]).p).toBeGreaterThan(0.05)
  })

  it('applies the tie correction to the variance', () => {
    const noTies = mannKendall([1, 2, 3, 4, 5])
    const withTies = mannKendall([1, 2, 2, 4, 5])
    expect(withTies.varS).toBeLessThan(noTies.varS)
  })

  it('Theil-Sen recovers an exact linear slope', () => {
    const x = [0, 1, 2, 3, 4]
    const y = x.map((v) => 3 * v + 1)
    expect(theilSen(x, y)).toBeCloseTo(3, 12)
  })

  it('Theil-Sen resists a single gross outlier where least squares would not', () => {
    const x = [0, 1, 2, 3, 4, 5]
    const y = [0, 1, 2, 3, 4, 100] // last point corrupted
    expect(theilSen(x, y)).toBeCloseTo(1, 10)
  })

  it('median and quantile behave on known inputs', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(quantile([0, 1, 2, 3, 4], 0.5)).toBe(2)
    expect(quantile([0, 10], 0.9)).toBeCloseTo(9, 10)
  })
})

// ---------------------------------------------------------------------------
// Agreement
// ---------------------------------------------------------------------------

describe('agreement measures', () => {
  it('kappa is 1 for perfect agreement and 0 at chance', () => {
    expect(cohensKappa(10, 0, 0, 10)).toBeCloseTo(1, 12)
    expect(cohensKappa(25, 25, 25, 25)).toBeCloseTo(0, 12)
  })

  it('kappa discounts agreement driven by high base rates', () => {
    // Both symptoms present on 90% of days. Raw overlap is high, kappa is not.
    const a = 81
    const b = 9
    const c = 9
    const d = 1
    expect(jaccard(a, b, c)).toBeGreaterThan(0.8)
    expect(Math.abs(cohensKappa(a, b, c, d))).toBeLessThan(0.1)
  })

  it('kappa is negative for systematic disagreement', () => {
    expect(cohensKappa(0, 10, 10, 0)).toBeLessThan(0)
  })
})

// ---------------------------------------------------------------------------
// Rate comparison
// ---------------------------------------------------------------------------

describe('binomial and Poisson rate tests', () => {
  it('binomTest matches exact values', () => {
    expect(binomTest(10, 10, 0.5)).toBeCloseTo(2 / 1024, 12)
    expect(binomTest(5, 10, 0.5)).toBeCloseTo(1, 12)
    expect(binomTest(0, 1, 0.5)).toBeCloseTo(1, 12)
  })

  it('binomTest is symmetric about p0 = 0.5', () => {
    expect(binomTest(3, 10, 0.5)).toBeCloseTo(binomTest(7, 10, 0.5), 12)
  })

  it('poissonRateTest finds no difference between equal rates', () => {
    const r = poissonRateTest(10, 30, 10, 30)
    expect(r.rateRatio).toBeCloseTo(1, 12)
    expect(r.p).toBeGreaterThan(0.5)
  })

  it('poissonRateTest detects a large rate increase', () => {
    // 8 non-menstrual pain days in the latest 28-day cycle vs 4 across 84 prior days.
    const r = poissonRateTest(8, 28, 4, 84)
    expect(r.rateRatio).toBeCloseTo(6, 6)
    expect(r.p).toBeLessThan(0.01)
  })

  it('returns p=1 when there are no events at all', () => {
    expect(poissonRateTest(0, 30, 0, 30).p).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Multiplicity
// ---------------------------------------------------------------------------

describe('Benjamini-Hochberg', () => {
  it('reproduces the standard worked example', () => {
    // p = .01 .02 .03 .04 .05 with n=5 -> every q-value equals 0.05
    const q = benjaminiHochberg([0.01, 0.02, 0.03, 0.04, 0.05])
    q.forEach((v) => expect(v).toBeCloseTo(0.05, 12))
  })

  it('preserves input order', () => {
    const q = benjaminiHochberg([0.5, 0.001, 0.2])
    expect(q[1]).toBeLessThan(q[2])
    expect(q[2]).toBeLessThan(q[0])
  })

  it('is monotone non-decreasing in sorted p order and never exceeds 1', () => {
    const p = [0.9, 0.8, 0.02, 0.6, 0.001, 0.04]
    const q = benjaminiHochberg(p)
    const pairs = p.map((v, i) => ({ p: v, q: q[i] })).sort((a, b) => a.p - b.p)
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i].q).toBeGreaterThanOrEqual(pairs[i - 1].q - 1e-12)
    }
    q.forEach((v) => expect(v).toBeLessThanOrEqual(1))
  })

  it('is at least as large as the raw p-value (never anti-conservative)', () => {
    const p = [0.001, 0.01, 0.03, 0.2, 0.7]
    const q = benjaminiHochberg(p)
    p.forEach((v, i) => expect(q[i]).toBeGreaterThanOrEqual(v - 1e-12))
  })

  it('handles the empty and singleton cases', () => {
    expect(benjaminiHochberg([])).toEqual([])
    expect(benjaminiHochberg([0.03])[0]).toBeCloseTo(0.03, 12)
  })
})

// ---------------------------------------------------------------------------
// Permutation testing
// ---------------------------------------------------------------------------

describe('permutation test', () => {
  const kappaStat = (labels: number[], values: number[]) => {
    let a = 0
    let b = 0
    let c = 0
    let d = 0
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === 1 && values[i] === 1) a++
      else if (labels[i] === 1) b++
      else if (values[i] === 1) c++
      else d++
    }
    return cohensKappa(a, b, c, d)
  }

  it('does not reject for independent series', () => {
    const rand = createRandom('independent')
    const labels = Array.from({ length: 80 }, () => (rand.bernoulli(0.4) ? 1 : 0))
    const values = Array.from({ length: 80 }, () => (rand.bernoulli(0.4) ? 1 : 0))
    const r = permutationTest(labels, values, kappaStat, 500, createRandom('perm').next)
    expect(r.p).toBeGreaterThan(0.05)
  })

  it('rejects for perfectly coupled series', () => {
    const rand = createRandom('coupled')
    const labels = Array.from({ length: 80 }, () => (rand.bernoulli(0.4) ? 1 : 0))
    const r = permutationTest(labels, [...labels], kappaStat, 500, createRandom('p2').next)
    expect(r.observed).toBeCloseTo(1, 10)
    expect(r.p).toBeLessThan(0.01)
  })

  it('never reports a p-value of exactly zero', () => {
    const labels = Array.from({ length: 40 }, (_, i) => (i < 20 ? 1 : 0))
    const r = permutationTest(labels, [...labels], kappaStat, 100, createRandom('p3').next)
    expect(r.p).toBeGreaterThan(0)
    expect(r.p).toBeCloseTo(1 / 101, 10)
  })

  it('is reproducible under a fixed seed', () => {
    const labels = Array.from({ length: 50 }, (_, i) => (i % 3 === 0 ? 1 : 0))
    const values = Array.from({ length: 50 }, (_, i) => (i % 4 === 0 ? 1 : 0))
    const a = permutationTest(labels, values, kappaStat, 200, createRandom('fixed').next)
    const b = permutationTest(labels, values, kappaStat, 200, createRandom('fixed').next)
    expect(a.p).toBe(b.p)
  })
})

// ---------------------------------------------------------------------------
// Classification metrics
// ---------------------------------------------------------------------------

describe('classification metrics', () => {
  it('computes textbook values for a known confusion matrix', () => {
    const m = classificationMetrics({ tp: 40, fp: 10, tn: 40, fn: 10 })
    expect(m.precision).toBeCloseTo(0.8, 12)
    expect(m.recall).toBeCloseTo(0.8, 12)
    expect(m.f1).toBeCloseTo(0.8, 12)
    expect(m.accuracy).toBeCloseTo(0.8, 12)
    expect(m.mcc).toBeCloseTo(0.6, 12)
  })

  it('MCC is 1 for a perfect classifier and 0 for an uninformative one', () => {
    expect(classificationMetrics({ tp: 10, fp: 0, tn: 10, fn: 0 }).mcc).toBeCloseTo(1, 12)
    expect(classificationMetrics({ tp: 5, fp: 5, tn: 5, fn: 5 }).mcc).toBeCloseTo(0, 12)
  })

  it('MCC exposes a degenerate all-positive classifier that F1 flatters', () => {
    // 90 positives, 10 negatives, classifier says "positive" every time.
    const m = classificationMetrics({ tp: 90, fp: 10, tn: 0, fn: 0 })
    expect(m.f1).toBeGreaterThan(0.9) // F1 looks excellent
    expect(m.mcc).toBeCloseTo(0, 12) // MCC correctly reports no skill
  })
})

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------

describe('seeded randomness', () => {
  it('produces identical streams for identical seeds', () => {
    const a = Array.from({ length: 20 }, mulberry32(42))
    const b = Array.from({ length: 20 }, mulberry32(42))
    expect(a).toEqual(b)
  })

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 20 }, mulberry32(1))
    const b = Array.from({ length: 20 }, mulberry32(2))
    expect(a).not.toEqual(b)
  })

  it('stays in [0,1) and has approximately uniform mean', () => {
    const next = mulberry32(2026)
    let sum = 0
    for (let i = 0; i < 20000; i++) {
      const v = next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      sum += v
    }
    expect(sum / 20000).toBeCloseTo(0.5, 2)
  })

  it('von Mises density peaks at mu and is symmetric around it', () => {
    expect(vonMisesRelativeDensity(1.2, 1.2, 4)).toBeCloseTo(1, 12)
    expect(vonMisesRelativeDensity(1.2 + 0.5, 1.2, 4)).toBeCloseTo(
      vonMisesRelativeDensity(1.2 - 0.5, 1.2, 4),
      12,
    )
    expect(vonMisesRelativeDensity(0, Math.PI, 4)).toBeLessThan(0.001)
  })

  it('von Mises density is flat when kappa is zero', () => {
    for (const theta of [0, 1, 2, 3, 4, 5]) {
      expect(vonMisesRelativeDensity(theta, 2, 0)).toBeCloseTo(1, 12)
    }
  })

  it('von Mises samples concentrate around mu as kappa grows', () => {
    const spread = (kappa: number) => {
      const next = mulberry32(5)
      const angles = Array.from({ length: 400 }, () => sampleVonMises(2.0, kappa, next))
      return 1 - circularMean(angles).rBar
    }
    expect(spread(8)).toBeLessThan(spread(2))
    expect(spread(2)).toBeLessThan(spread(0.2))
  })
})
