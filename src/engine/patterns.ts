/**
 * patterns.ts — Pattern detection.
 *
 * Each detector answers one clinical question with one named statistical test and
 * returns a `Finding` carrying its test statistic, effect size, confidence interval,
 * the coverage it was computed from, and the exact dates that produced it.
 *
 * Two safeguards run after detection and before anything can reach the brief:
 *
 *   1. MULTIPLICITY. The engine runs 20-40 tests per patient. At an uncorrected
 *      alpha of 0.05 we would expect 1-2 spurious findings in every single brief.
 *      All p-values are adjusted together by Benjamini-Hochberg, and the gate tests
 *      the q-value, not the p-value.
 *
 *   2. EVIDENCE GATING. A finding is suppressed unless it rests on enough data:
 *      coverage, complete cycles, and observed days all have floors. A suppressed
 *      finding is not deleted — it is returned with a `gateReason` so the UI can show
 *      "not enough data yet" rather than silently omitting it, which would let a
 *      reader mistake absence of evidence for evidence of absence.
 */

import { detectAllBaselineChanges } from './baseline'
import {
  angleToSignedCycleDay,
  pairedObservations,
  presentDates,
  presentPhaseAngles,
  summariseImpact,
  type FeatureContext,
} from './features'
import { createRandom } from './rng'
import {
  benjaminiHochberg,
  cohensKappa,
  fisherExact,
  jaccard,
  mannKendall,
  poissonRateTest,
  rayleighTest,
  riskRatio,
  theilSen,
  wilsonInterval,
} from './stats'
import type { Finding, PatternKind } from './types'

// ---------------------------------------------------------------------------
// Gate configuration
// ---------------------------------------------------------------------------

export interface GateConfig {
  /** Minimum observed-day coverage within the analysis window. */
  minCoverage: number
  /** Minimum number of complete (closed) cycles. */
  minCompleteCycles: number
  /** Minimum observed days for a symptom before any test is reported. */
  minObservedDays: number
  /** Minimum present-days; below this, even a significant test is unstable. */
  minEvents: number
  /** FDR level. A finding must have q below this to be reported. */
  alpha: number
  /** Permutation iterations for co-occurrence. */
  permutations: number
  /** Seed for permutation testing, so briefs are reproducible. */
  seed: string
}

export const DEFAULT_GATE: GateConfig = {
  // 0.60 is a deliberate compromise. Below ~50% coverage, a menstrual-window rate
  // computed from the days someone chose to log is badly exposed to the exact bias we
  // care about most: people log more on bad days. 0.60 keeps most real users' data
  // usable while excluding the sparse records where that bias dominates. The
  // evaluation harness measures exactly how F1 degrades across this threshold.
  minCoverage: 0.6,
  minCompleteCycles: 2,
  minObservedDays: 21,
  minEvents: 4,
  alpha: 0.05,
  permutations: 2000,
  seed: 'medtrace-permutation-v1',
}

// ---------------------------------------------------------------------------
// Detector: cyclicity
// ---------------------------------------------------------------------------

/**
 * Is this symptom concentrated around menstruation?
 *
 * Primary test: Fisher's exact on the menstrual-window vs non-menstrual-window 2x2.
 * Effect size: risk ratio with a log-transformed CI.
 * Secondary: Rayleigh test on the phase angles, which needs no window boundary and so
 * acts as a check that the primary result is not an artefact of where we drew the
 * window edge. The peak phase is reported from the circular mean.
 */
export function detectCyclicity(ctx: FeatureContext, symptomId: string): Finding {
  const f = ctx.features.get(symptomId)!
  const mwAbsent = f.menstrualWindowObserved - f.menstrualWindowPresent
  const nonMwAbsent = f.nonMenstrualObserved - f.nonMenstrualPresent

  const fisher = fisherExact(f.menstrualWindowPresent, mwAbsent, f.nonMenstrualPresent, nonMwAbsent)
  const rr = riskRatio(
    f.menstrualWindowPresent,
    f.menstrualWindowObserved,
    f.nonMenstrualPresent,
    f.nonMenstrualObserved,
  )

  const angles = presentPhaseAngles(ctx, symptomId)
  const rayleigh = rayleighTest(angles)
  const medianCycleLength =
    ctx.cycles.filter((c) => c.complete).reduce((s, c) => s + c.lengthDays, 0) /
      Math.max(1, ctx.cycles.filter((c) => c.complete).length) || 28
  const peakDay = angleToSignedCycleDay(rayleigh.meanAngle, medianCycleLength)

  const mwCi = wilsonInterval(f.menstrualWindowPresent, f.menstrualWindowObserved)
  const nonMwCi = wilsonInterval(f.nonMenstrualPresent, f.nonMenstrualObserved)

  return {
    id: `cyclicity:${symptomId}`,
    kind: 'cyclicity',
    symptomId,
    values: {
      menstrualPresent: f.menstrualWindowPresent,
      menstrualObserved: f.menstrualWindowObserved,
      menstrualRate: f.menstrualWindowRate,
      menstrualRateLow: mwCi.low,
      menstrualRateHigh: mwCi.high,
      nonMenstrualPresent: f.nonMenstrualPresent,
      nonMenstrualObserved: f.nonMenstrualObserved,
      nonMenstrualRate: f.nonMenstrualRate,
      nonMenstrualRateLow: nonMwCi.low,
      nonMenstrualRateHigh: nonMwCi.high,
      riskRatio: rr.rr,
      riskRatioLow: rr.ci.low,
      riskRatioHigh: rr.ci.high,
      rayleighP: rayleigh.p,
      rayleighR: rayleigh.rBar,
      peakCycleDay: peakDay,
      cyclesWithSymptom: f.cyclesWithSymptom,
      cyclesObserved: f.cyclesObserved,
    },
    test: { name: "Fisher's exact test", statistic: rr.rr, p: fisher.pTwoSided },
    effect: {
      label: 'Risk ratio (menstrual window vs rest of cycle)',
      value: rr.rr,
      ci: rr.ci,
      unit: 'x',
    },
    coverage: f.coverage,
    observedDays: f.observedDays,
    evidenceDates: presentDates(ctx, symptomId),
    passed: false,
  }
}

// ---------------------------------------------------------------------------
// Detector: persistence
// ---------------------------------------------------------------------------

/**
 * Is this symptom present outside menstruation rather than confined to it?
 *
 * Clinically this is the counterpart to cyclicity and is not merely its negation: a
 * symptom can be both elevated perimenstrually *and* frequently present the rest of
 * the month, and that combination reads very differently from pure dysmenorrhoea.
 * Descriptive rather than inferential, so it carries a Wilson interval and no p-value
 * and does not enter the multiplicity correction.
 */
export function detectPersistence(ctx: FeatureContext, symptomId: string): Finding {
  const f = ctx.features.get(symptomId)!
  const ci = wilsonInterval(f.nonMenstrualPresent, f.nonMenstrualObserved)

  const nonMenstrualDates = presentDates(ctx, symptomId).filter(
    (d) => ctx.aligned.get(d)?.inMenstrualWindow === false,
  )

  return {
    id: `persistence:${symptomId}`,
    kind: 'persistence',
    symptomId,
    values: {
      nonMenstrualPresent: f.nonMenstrualPresent,
      nonMenstrualObserved: f.nonMenstrualObserved,
      nonMenstrualRate: f.nonMenstrualRate,
      rateLow: ci.low,
      rateHigh: ci.high,
    },
    effect: {
      label: 'Non-menstrual occurrence rate',
      value: f.nonMenstrualRate,
      ci,
      unit: '%',
    },
    coverage: f.coverage,
    observedDays: f.observedDays,
    evidenceDates: nonMenstrualDates,
    passed: false,
  }
}

// ---------------------------------------------------------------------------
// Detector: trend
// ---------------------------------------------------------------------------

/**
 * Is the symptom becoming more or less frequent across cycles?
 *
 * Mann-Kendall on the per-cycle occurrence rates, with a Theil-Sen slope to give the
 * change a magnitude. Both are rank-based: with 3-6 cycles, a least-squares slope
 * would be dictated by whichever cycle happened to be worst.
 */
export function detectTrend(ctx: FeatureContext, symptomId: string): Finding {
  const f = ctx.features.get(symptomId)!
  const rates = f.perCycleRates
  const x = rates.map((_, i) => i)
  const mk = mannKendall(rates)
  const slope = rates.length >= 2 ? theilSen(x, rates) : 0

  return {
    id: `trend:${symptomId}`,
    kind: 'trend',
    symptomId,
    values: {
      cycles: rates.length,
      slopePerCycle: Number.isFinite(slope) ? slope : 0,
      firstCycleRate: rates[0] ?? 0,
      lastCycleRate: rates[rates.length - 1] ?? 0,
      kendallS: mk.s,
    },
    test: { name: 'Mann-Kendall trend test', statistic: mk.s, p: mk.p },
    effect: {
      label: 'Theil-Sen slope',
      value: Number.isFinite(slope) ? slope : 0,
      unit: 'rate change per cycle',
    },
    coverage: f.coverage,
    observedDays: f.observedDays,
    evidenceDates: presentDates(ctx, symptomId),
    passed: false,
  }
}

// ---------------------------------------------------------------------------
// Detector: co-occurrence
// ---------------------------------------------------------------------------

/**
 * Do two symptoms appear together more often than their individual frequencies
 * explain?
 *
 * Cohen's kappa measures agreement above chance; significance comes from a
 * permutation test rather than a closed form, because consecutive days are not
 * independent and the asymptotic variance of kappa would be optimistic.
 * Only days on which BOTH symptoms were actually asked enter the table.
 */
export function detectCoOccurrence(
  ctx: FeatureContext,
  symptomA: string,
  symptomB: string,
  gate: GateConfig,
): Finding {
  const { a, b, dates } = pairedObservations(ctx, symptomA, symptomB)

  let tp = 0
  let aOnly = 0
  let bOnly = 0
  let neither = 0
  const bothDates: string[] = []
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 1 && b[i] === 1) {
      tp++
      bothDates.push(dates[i])
    } else if (a[i] === 1) aOnly++
    else if (b[i] === 1) bOnly++
    else neither++
  }

  const kappa = cohensKappa(tp, aOnly, bOnly, neither)
  const jac = jaccard(tp, aOnly, bOnly)

  // Permutation null: shuffle one series, preserving both marginals.
  const rand = createRandom(`${gate.seed}:${symptomA}:${symptomB}`)
  const shuffled = [...a]
  let atLeastAsExtreme = 0
  for (let iter = 0; iter < gate.permutations; iter++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand.next() * (i + 1))
      const t = shuffled[i]
      shuffled[i] = shuffled[j]
      shuffled[j] = t
    }
    let s11 = 0
    let s10 = 0
    let s01 = 0
    let s00 = 0
    for (let i = 0; i < shuffled.length; i++) {
      if (shuffled[i] === 1 && b[i] === 1) s11++
      else if (shuffled[i] === 1) s10++
      else if (b[i] === 1) s01++
      else s00++
    }
    if (Math.abs(cohensKappa(s11, s10, s01, s00)) >= Math.abs(kappa)) atLeastAsExtreme++
  }
  const p = (atLeastAsExtreme + 1) / (gate.permutations + 1)

  return {
    id: `co_occurrence:${symptomA}:${symptomB}`,
    kind: 'co_occurrence',
    symptomId: symptomA,
    secondarySymptomId: symptomB,
    values: {
      bothPresent: tp,
      firstOnly: aOnly,
      secondOnly: bOnly,
      neither,
      pairedDays: a.length,
      kappa,
      jaccard: jac,
    },
    test: { name: 'Permutation test on Cohen’s kappa', statistic: kappa, p },
    effect: { label: "Cohen's kappa", value: kappa },
    coverage: a.length / Math.max(1, ctx.calendarDays),
    observedDays: a.length,
    evidenceDates: bothDates,
    passed: false,
  }
}

// ---------------------------------------------------------------------------
// Detector: functional burden
// ---------------------------------------------------------------------------

/**
 * How often did symptoms interfere with normal life, and is that changing?
 *
 * Kept separate from symptom severity throughout, because the two dissociate: the
 * outcome literature is explicit that pain intensity alone understates disease
 * burden, and a patient can have stable pain scores with rising activity limitation.
 */
export function detectFunctionalBurden(ctx: FeatureContext): Finding {
  const impact = summariseImpact(ctx)

  // Limiting-impact rate per cycle, for a trend test on burden itself.
  const perCycle = new Map<number, { limiting: number; observed: number }>()
  for (const date of ctx.orderedDates) {
    const day = ctx.daysByDate.get(date)
    if (!day?.logged || day.impact === undefined) continue
    const idx = ctx.aligned.get(date)?.cycleIndex
    if (idx === undefined) continue
    const entry = perCycle.get(idx) ?? { limiting: 0, observed: 0 }
    entry.observed++
    if (day.impact >= 2) entry.limiting++
    perCycle.set(idx, entry)
  }

  const rates = [...perCycle.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, v]) => v.observed >= 5)
    .map(([, v]) => v.limiting / v.observed)

  const mk = mannKendall(rates)
  const slope = rates.length >= 2 ? theilSen(rates.map((_, i) => i), rates) : 0

  const limitingDates = ctx.orderedDates.filter((d) => {
    const day = ctx.daysByDate.get(d)
    return day?.logged && day.impact !== undefined && day.impact >= 2
  })

  const ci = wilsonInterval(impact.limitingDays, impact.observedDays)

  return {
    id: 'functional_burden',
    kind: 'functional_burden',
    values: {
      limitingDays: impact.limitingDays,
      couldNotPerformDays: impact.couldNotPerformDays,
      observedDays: impact.observedDays,
      limitingRate: impact.observedDays > 0 ? impact.limitingDays / impact.observedDays : 0,
      rateLow: ci.low,
      rateHigh: ci.high,
      slopePerCycle: Number.isFinite(slope) ? slope : 0,
      cycles: rates.length,
    },
    test: { name: 'Mann-Kendall trend test', statistic: mk.s, p: mk.p },
    effect: { label: 'Activity-limiting days', value: impact.limitingDays, unit: 'days' },
    coverage: ctx.coverage,
    observedDays: impact.observedDays,
    evidenceDates: limitingDates,
    passed: false,
  }
}

// ---------------------------------------------------------------------------
// Detector: treatment response
// ---------------------------------------------------------------------------

/**
 * Did a symptom's rate change after a treatment started?
 *
 * Exact Poisson rate comparison between the pre-treatment and on-treatment periods.
 * This is explicitly a *description of what was recorded*, not a causal claim, and the
 * brief wording reflects that — many things change at the same time a treatment
 * starts, and a single-patient before/after has no control.
 */
export function detectTreatmentResponse(
  ctx: FeatureContext,
  symptomId: string,
  treatmentId: string,
): Finding | null {
  const treatment = ctx.record.treatments.find((t) => t.id === treatmentId)
  if (!treatment) return null

  let beforePresent = 0
  let beforeObserved = 0
  let duringPresent = 0
  let duringObserved = 0
  const duringDates: string[] = []

  for (const date of ctx.orderedDates) {
    const day = ctx.daysByDate.get(date)
    if (!day?.logged) continue
    const obs = day.symptoms[symptomId]
    if (!obs || obs.state === 'unknown') continue

    const onTreatment =
      date >= treatment.startDate && (!treatment.endDate || date <= treatment.endDate)

    if (onTreatment) {
      duringObserved++
      if (obs.state === 'present') {
        duringPresent++
        duringDates.push(date)
      }
    } else if (date < treatment.startDate) {
      beforeObserved++
      if (obs.state === 'present') beforePresent++
    }
  }

  if (beforeObserved === 0 || duringObserved === 0) return null

  const rate = poissonRateTest(duringPresent, duringObserved, beforePresent, beforeObserved)

  return {
    id: `treatment_response:${treatmentId}:${symptomId}`,
    kind: 'treatment_response',
    symptomId,
    values: {
      beforePresent,
      beforeObserved,
      beforeRate: beforePresent / beforeObserved,
      duringPresent,
      duringObserved,
      duringRate: duringPresent / duringObserved,
      rateRatio: Number.isFinite(rate.rateRatio) ? rate.rateRatio : 0,
    },
    test: { name: 'Exact Poisson rate comparison', statistic: rate.rateRatio, p: rate.p },
    effect: {
      label: 'Rate ratio (on treatment vs before)',
      value: Number.isFinite(rate.rateRatio) ? rate.rateRatio : 0,
      unit: 'x',
    },
    coverage: ctx.coverage,
    observedDays: beforeObserved + duringObserved,
    evidenceDates: duringDates,
    passed: false,
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface PatternResult {
  /** Findings that passed every gate. Only these may reach the brief. */
  findings: Finding[]
  /** Findings that were computed but suppressed, each with its reason. */
  suppressed: Finding[]
  /** Number of hypothesis tests entered into the FDR correction. */
  testsRun: number
}

/**
 * Symptom pairs considered for co-occurrence.
 * Restricted to the most-present symptoms to keep the number of tests proportionate —
 * testing all pairs of 30 symptoms would be 435 tests and would cost far more power
 * under FDR than the extra pairs are worth.
 */
function candidatePairs(ctx: FeatureContext, limit = 6): [string, string][] {
  const ranked = [...ctx.features.values()]
    .filter((f) => f.daysPresent >= 3)
    .sort((a, b) => b.daysPresent - a.daysPresent)
    .slice(0, limit)
    .map((f) => f.symptomId)

  const pairs: [string, string][] = []
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) pairs.push([ranked[i], ranked[j]])
  }
  return pairs
}

export function runPatternEngine(
  ctx: FeatureContext,
  gate: GateConfig = DEFAULT_GATE,
): PatternResult {
  const all: Finding[] = []

  for (const symptomId of ctx.symptomIds) {
    const f = ctx.features.get(symptomId)
    if (!f || f.daysPresent === 0) continue // never recorded present: nothing to describe
    all.push(detectCyclicity(ctx, symptomId))
    all.push(detectPersistence(ctx, symptomId))
    all.push(detectTrend(ctx, symptomId))
  }

  for (const [a, b] of candidatePairs(ctx)) {
    all.push(detectCoOccurrence(ctx, a, b, gate))
  }

  all.push(detectFunctionalBurden(ctx))

  // Change from the patient's own prior cycles. Included here rather than run
  // separately so it shares the single multiplicity correction with everything else.
  for (const finding of detectAllBaselineChanges(ctx, gate.minEvents - 1)) {
    all.push(finding)
  }

  for (const treatment of ctx.record.treatments) {
    for (const symptomId of ctx.symptomIds) {
      const f = ctx.features.get(symptomId)
      if (!f || f.daysPresent < gate.minEvents) continue
      const finding = detectTreatmentResponse(ctx, symptomId, treatment.id)
      if (finding) all.push(finding)
    }
  }

  // --- Multiplicity: one correction across every test for this patient ---
  const tested = all.filter((f) => f.test !== undefined)
  const qValues = benjaminiHochberg(tested.map((f) => f.test!.p))
  tested.forEach((f, i) => {
    f.test!.q = qValues[i]
  })

  // --- Gate ---
  const completeCycles = ctx.cycles.filter((c) => c.complete).length
  const findings: Finding[] = []
  const suppressed: Finding[] = []

  for (const finding of all) {
    const reason = gateReasonFor(finding, ctx, completeCycles, gate)
    if (reason) {
      finding.passed = false
      finding.gateReason = reason
      suppressed.push(finding)
    } else {
      finding.passed = true
      findings.push(finding)
    }
  }

  return { findings, suppressed, testsRun: tested.length }
}

function gateReasonFor(
  finding: Finding,
  ctx: FeatureContext,
  completeCycles: number,
  gate: GateConfig,
): Finding['gateReason'] | null {
  if (finding.coverage < gate.minCoverage) return 'insufficient_coverage'
  if (finding.observedDays < gate.minObservedDays) return 'insufficient_coverage'

  // Anything reasoning about cycle position or change across cycles needs cycles.
  const needsCycles: PatternKind[] = ['cyclicity', 'trend', 'treatment_response', 'baseline_change']
  if (needsCycles.includes(finding.kind) && completeCycles < gate.minCompleteCycles) {
    return 'insufficient_cycles'
  }

  const events = finding.evidenceDates.length
  if (finding.kind !== 'functional_burden' && events < gate.minEvents) {
    return 'insufficient_events'
  }

  // Inferential findings must clear the FDR threshold. Descriptive ones (persistence)
  // carry no test and are reported with their interval instead.
  if (finding.test && (finding.test.q ?? finding.test.p) >= gate.alpha) {
    return 'not_significant'
  }

  return null
}
