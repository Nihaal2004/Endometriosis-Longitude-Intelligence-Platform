/**
 * rng.ts — Seeded pseudo-random number generation.
 *
 * All randomness in this project (synthetic cohort generation, permutation tests)
 * flows through here so that every reported number is reproducible from a seed.
 * Math.random() is never called anywhere in src/engine or src/data.
 */

/**
 * mulberry32 — a small, fast 32-bit PRNG with good statistical properties for
 * simulation work. Period 2^32, passes gjrand's basic test battery.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministically derive a 32-bit seed from a string label. FNV-1a. */
export function seedFromString(label: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

export interface Random {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number
  /** True with probability p. */
  bernoulli(p: number): boolean
  /** Standard normal via Box-Muller. */
  normal(mean?: number, sd?: number): number
  /** Uniform choice from a non-empty array. */
  pick<T>(items: readonly T[]): T
}

export function createRandom(seed: number | string): Random {
  const next = mulberry32(typeof seed === 'string' ? seedFromString(seed) : seed)
  let spare: number | null = null

  return {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1))
    },
    bernoulli(p) {
      return next() < p
    },
    normal(mean = 0, sd = 1) {
      if (spare !== null) {
        const value = spare
        spare = null
        return mean + sd * value
      }
      // Box-Muller, rejecting the degenerate u=0 case.
      let u = 0
      while (u === 0) u = next()
      const v = next()
      const mag = Math.sqrt(-2 * Math.log(u))
      spare = mag * Math.sin(2 * Math.PI * v)
      return mean + sd * mag * Math.cos(2 * Math.PI * v)
    },
    pick(items) {
      return items[Math.floor(next() * items.length)]
    },
  }
}

/**
 * Sample from a von Mises distribution (the circular analogue of a normal).
 *
 * Used by the synthetic cohort generator to place symptom occurrences at a phase
 * `mu` with concentration `kappa`. kappa = 0 is uniform around the cycle (a
 * non-cyclical symptom); larger kappa means tighter clustering at mu. This gives the
 * evaluation harness a continuous, principled effect-size knob.
 *
 * Best-Fisher (1979) rejection algorithm.
 */
export function sampleVonMises(mu: number, kappa: number, next: () => number): number {
  if (kappa < 1e-6) return 2 * Math.PI * next() // effectively uniform

  const a = 1 + Math.sqrt(1 + 4 * kappa * kappa)
  const b = (a - Math.sqrt(2 * a)) / (2 * kappa)
  const r = (1 + b * b) / (2 * b)

  let f = 0
  for (let guard = 0; guard < 1000; guard++) {
    const u1 = next()
    const z = Math.cos(Math.PI * u1)
    f = (1 + r * z) / (r + z)
    const c = kappa * (r - f)
    const u2 = next()
    if (c * (2 - c) - u2 > 0 || Math.log(c / u2) + 1 - c >= 0) break
  }

  const u3 = next()
  const theta = mu + Math.sign(u3 - 0.5) * Math.acos(f)
  // Normalise into [0, 2π)
  return ((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
}

/**
 * von Mises probability density, normalised so the peak equals 1.
 *
 * The generator uses this as a multiplier on a baseline occurrence probability, so a
 * symptom's peak-phase probability is `base * peakMultiplier` and its trough-phase
 * probability is lower by exp(-2*kappa). Keeping the peak at 1 makes the effect size
 * interpretable independently of kappa.
 */
export function vonMisesRelativeDensity(theta: number, mu: number, kappa: number): number {
  if (kappa < 1e-6) return 1
  return Math.exp(kappa * (Math.cos(theta - mu) - 1))
}
