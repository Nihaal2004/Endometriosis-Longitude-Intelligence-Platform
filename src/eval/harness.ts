/**
 * harness.ts — Evaluation of the pattern engine against known ground truth.
 *
 * WHAT IS AND IS NOT BEING MEASURED
 *
 * These are ENGINE-VALIDATION experiments on synthetic data generated from a known
 * process. They establish that the detectors recover structure that is genuinely
 * present, reject structure that is genuinely absent, and degrade predictably as data
 * quality falls.
 *
 * They establish nothing whatsoever about clinical utility. No claim about diagnostic
 * delay, referral decisions or patient outcomes can be drawn from any number produced
 * by this file. That would require prospective clinical evaluation, and the reported
 * metrics are deliberately confined to properties of the computation itself.
 *
 * The comparison baselines matter as much as the headline numbers. Two ablations stand
 * in for how a conventional symptom tracker would reach the same conclusion:
 *
 *   DESCRIPTIVE  — "this happens more around your period": a ratio threshold with no
 *                  hypothesis test, but still respecting unknown days.
 *   ZERO-IMPUTED — the same rule, but treating unlogged days as symptom-free, which is
 *                  what an empty calendar cell implies in most consumer trackers.
 *
 * Comparing the three isolates the contribution of each design decision.
 */

import { generateCohort, type CohortConfig } from '../data/generator'
import { buildFeatureContext, defaultWindow, type FeatureContext } from '../engine/features'
import { generateBrief } from '../engine/brief'
import { verifyBrief, mutateClaim } from '../engine/fidelity'
import { planDailyQuestions } from '../engine/adaptive'
import { SYMPTOMS } from '../engine/symptoms'
import { DEFAULT_GATE, detectCyclicity, runPatternEngine, type GateConfig } from '../engine/patterns'
import { createRandom } from '../engine/rng'
import { classificationMetrics, quantile, type ClassificationMetrics, type ConfusionMatrix } from '../engine/stats'
import type { PatientRecord } from '../engine/types'

const COHORT_END_DATE = '2026-09-01'

// ---------------------------------------------------------------------------
// Classifiers under comparison
// ---------------------------------------------------------------------------

export type ClassifierName = 'medtrace' | 'descriptive' | 'zero_imputed'

/** The full engine: Fisher's exact + FDR + evidence gate. */
function medtracePredicts(ctx: FeatureContext, gate: GateConfig): Set<string> {
  const { findings } = runPatternEngine(ctx, gate)
  return new Set(
    findings.filter((f) => f.kind === 'cyclicity' && f.symptomId).map((f) => f.symptomId!),
  )
}

/**
 * Ablation 1: ratio threshold, no hypothesis test, no multiplicity control.
 * Unknown days are still excluded, so this isolates the effect of removing inference.
 */
function descriptivePredicts(ctx: FeatureContext, ratio = 1.5): Set<string> {
  const out = new Set<string>()
  for (const [id, f] of ctx.features) {
    if (f.daysPresent === 0) continue
    const nonMenstrual = f.nonMenstrualRate
    // A zero non-menstrual rate would divide by zero; treat it as "clearly elevated",
    // which is the charitable reading for this baseline.
    if (nonMenstrual === 0) {
      if (f.menstrualWindowPresent > 0) out.add(id)
      continue
    }
    if (f.menstrualWindowRate / nonMenstrual >= ratio) out.add(id)
  }
  return out
}

/**
 * Ablation 2: the same rule, but unlogged days are counted as symptom-free.
 * This is the single most consequential difference between this engine and a
 * calendar-cell tracker, so it gets measured directly.
 */
function zeroImputedPredicts(ctx: FeatureContext, ratio = 1.5): Set<string> {
  const out = new Set<string>()

  for (const symptomId of ctx.symptomIds) {
    let mwPresent = 0
    let mwTotal = 0
    let nonPresent = 0
    let nonTotal = 0

    for (const date of ctx.orderedDates) {
      const aligned = ctx.aligned.get(date)
      if (!aligned) continue
      const day = ctx.daysByDate.get(date)
      // The defining move: an unlogged day counts in the denominator as "no symptom".
      const present = day?.logged && day.symptoms[symptomId]?.state === 'present'
      if (aligned.inMenstrualWindow) {
        mwTotal++
        if (present) mwPresent++
      } else {
        nonTotal++
        if (present) nonPresent++
      }
    }

    if (mwPresent === 0) continue
    const mwRate = mwTotal > 0 ? mwPresent / mwTotal : 0
    const nonRate = nonTotal > 0 ? nonPresent / nonTotal : 0
    if (nonRate === 0 ? mwPresent > 0 : mwRate / nonRate >= ratio) out.add(symptomId)
  }

  return out
}

function predictionsFor(
  name: ClassifierName,
  ctx: FeatureContext,
  gate: GateConfig,
): Set<string> {
  if (name === 'medtrace') return medtracePredicts(ctx, gate)
  if (name === 'descriptive') return descriptivePredicts(ctx)
  return zeroImputedPredicts(ctx)
}

// ---------------------------------------------------------------------------
// Core scoring loop
// ---------------------------------------------------------------------------

export interface ScoredCohort extends ClassificationMetrics {
  classifier: ClassifierName
  /** Mean observed-day coverage across the cohort. */
  meanCoverage: number
  patients: number
}

export function scoreCohort(
  cohort: PatientRecord[],
  classifier: ClassifierName,
  gate: GateConfig = DEFAULT_GATE,
): ScoredCohort {
  const cm: ConfusionMatrix = { tp: 0, fp: 0, tn: 0, fn: 0 }
  let coverageSum = 0

  for (const record of cohort) {
    const ctx = buildFeatureContext(record, fullWindow(record))
    coverageSum += ctx.coverage

    const predicted = predictionsFor(classifier, ctx, gate)
    const truth = record.groundTruth!.symptoms

    for (const [symptomId, gt] of Object.entries(truth)) {
      const isPredicted = predicted.has(symptomId)
      if (gt.cyclical && isPredicted) cm.tp++
      else if (gt.cyclical && !isPredicted) cm.fn++
      else if (!gt.cyclical && isPredicted) cm.fp++
      else cm.tn++
    }
  }

  return {
    classifier,
    ...classificationMetrics(cm),
    meanCoverage: cohort.length > 0 ? coverageSum / cohort.length : 0,
    patients: cohort.length,
  }
}

/** Analyse the whole record rather than the default trailing 92 days. */
function fullWindow(record: PatientRecord) {
  const dates = record.days.map((d) => d.date).sort()
  return { start: dates[0], end: dates[dates.length - 1] }
}

// ---------------------------------------------------------------------------
// Experiment 1: headline detection performance
// ---------------------------------------------------------------------------

export interface DetectionExperiment {
  kappa: number
  missingness: { mode: 'mcar' | 'mar'; rate: number }
  days: number
  patients: number
  results: ScoredCohort[]
}

export function runDetectionExperiment(
  cohortConfig: Partial<CohortConfig> = {},
): DetectionExperiment {
  const config: CohortConfig = {
    patients: 60,
    days: 180,
    endDate: COHORT_END_DATE,
    missingness: { mode: 'mcar', rate: 0.1 },
    kappa: 4,
    cyclicalFraction: 0.5,
    seedPrefix: 'detect',
    symptomsPerPatient: 4,
    ...cohortConfig,
  }

  const cohort = generateCohort(config)
  const results: ScoredCohort[] = (['medtrace', 'descriptive', 'zero_imputed'] as ClassifierName[])
    .map((name) => scoreCohort(cohort, name))

  return {
    kappa: config.kappa,
    missingness: config.missingness,
    days: config.days,
    patients: config.patients,
    results,
  }
}

// ---------------------------------------------------------------------------
// Experiment 2: detection power vs effect size
// ---------------------------------------------------------------------------

export interface PowerPoint {
  kappa: number
  /** Proportion of the cycle's days falling in the peak half-width, for interpretation. */
  concentration: number
  medtrace: { recall: number; specificity: number; f1: number }
  descriptive: { recall: number; specificity: number; f1: number }
}

export function runPowerSweep(kappas: number[] = [0, 0.5, 1, 2, 3, 4, 6, 8]): PowerPoint[] {
  return kappas.map((kappa) => {
    const cohort = generateCohort({
      patients: 50,
      days: 180,
      endDate: COHORT_END_DATE,
      missingness: { mode: 'mcar', rate: 0.1 },
      kappa,
      cyclicalFraction: 0.5,
      seedPrefix: `power-${kappa}`,
      symptomsPerPatient: 4,
      // Hold expected prevalence fixed across the sweep so kappa is a clean
      // effect-size axis rather than a confounded effect-size-and-sample-size axis.
      targetPrevalence: 0.2,
    })

    const mt = scoreCohort(cohort, 'medtrace')
    const desc = scoreCohort(cohort, 'descriptive')

    return {
      kappa,
      // Mean resultant length of the generating kernel: a kappa-free reading of how
      // tightly occurrences cluster, comparable to the R-bar the engine reports.
      concentration: besselRatio(kappa),
      medtrace: { recall: mt.recall, specificity: mt.specificity, f1: mt.f1 },
      descriptive: { recall: desc.recall, specificity: desc.specificity, f1: desc.f1 },
    }
  })
}

/** I1(k)/I0(k) — the mean resultant length of a von Mises with concentration k. */
function besselRatio(kappa: number, steps = 720): number {
  if (kappa < 1e-9) return 0
  let i0 = 0
  let i1 = 0
  for (let i = 0; i < steps; i++) {
    const t = (Math.PI * i) / steps
    i0 += Math.exp(kappa * Math.cos(t))
    i1 += Math.exp(kappa * Math.cos(t)) * Math.cos(t)
  }
  return i1 / i0
}

// ---------------------------------------------------------------------------
// Experiment 3: robustness to missing data
// ---------------------------------------------------------------------------

export interface RobustnessPoint {
  missingnessRate: number
  mode: 'mcar' | 'mar'
  meanCoverage: number
  /** With the evidence gate active — what the product actually reports. */
  gated: { precision: number; recall: number; f1: number; reported: number }
  /** With the gate disabled — what the detector would do unprotected. */
  ungated: { precision: number; recall: number; f1: number; reported: number }
  zeroImputed: { precision: number; recall: number; f1: number }
}

export function runRobustnessSweep(
  rates: number[] = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
  modes: ('mcar' | 'mar')[] = ['mcar', 'mar'],
): RobustnessPoint[] {
  const points: RobustnessPoint[] = []

  // Disabling the gate isolates detector behaviour from the product's refusal to
  // report. Significance still applies; only the data-sufficiency floors are removed.
  const noGate: GateConfig = {
    ...DEFAULT_GATE,
    minCoverage: 0,
    minCompleteCycles: 0,
    minObservedDays: 0,
    minEvents: 0,
  }

  for (const mode of modes) {
    for (const rate of rates) {
      const cohort = generateCohort({
        patients: 50,
        days: 180,
        endDate: COHORT_END_DATE,
        missingness: { mode, rate },
        kappa: 4,
        cyclicalFraction: 0.5,
        seedPrefix: `robust-${mode}-${rate}`,
        symptomsPerPatient: 4,
      })

      const gated = scoreCohort(cohort, 'medtrace', DEFAULT_GATE)
      const ungated = scoreCohort(cohort, 'medtrace', noGate)
      const zero = scoreCohort(cohort, 'zero_imputed')

      points.push({
        missingnessRate: rate,
        mode,
        meanCoverage: gated.meanCoverage,
        gated: {
          precision: gated.precision,
          recall: gated.recall,
          f1: gated.f1,
          reported: gated.tp + gated.fp,
        },
        ungated: {
          precision: ungated.precision,
          recall: ungated.recall,
          f1: ungated.f1,
          reported: ungated.tp + ungated.fp,
        },
        zeroImputed: { precision: zero.precision, recall: zero.recall, f1: zero.f1 },
      })
    }
  }

  return points
}

// ---------------------------------------------------------------------------
// Experiment 4: fidelity and mutation catch rate
// ---------------------------------------------------------------------------

export interface FidelityExperiment {
  briefsGenerated: number
  totalClaims: number
  verifiedClaims: number
  verificationRate: number
  keyCoverage: number
  mutationsInjected: number
  mutationsCaught: number
  mutationCatchRate: number
}

export function runFidelityExperiment(patients = 30): FidelityExperiment {
  const cohort = generateCohort({
    patients,
    days: 180,
    endDate: COHORT_END_DATE,
    missingness: { mode: 'mcar', rate: 0.12 },
    kappa: 5,
    cyclicalFraction: 0.5,
    seedPrefix: 'fidelity',
    symptomsPerPatient: 4,
  })

  const rand = createRandom('fidelity-mutations')
  let totalClaims = 0
  let verifiedClaims = 0
  let keyTotal = 0
  let keyChecked = 0
  let injected = 0
  let caught = 0

  for (const record of cohort) {
    const ctx = buildFeatureContext(record, fullWindow(record))
    const { findings, suppressed } = runPatternEngine(ctx)
    const brief = generateBrief(ctx, findings, suppressed)

    const report = verifyBrief(brief.claims, record, brief.windowStart, brief.windowEnd)
    totalClaims += report.totalClaims
    verifiedClaims += report.verifiedClaims
    keyTotal += report.totalKeys
    keyChecked += report.checkedKeys

    // Mutation testing: corrupt one verifiable number per claim and confirm the
    // checker rejects it. This is what turns "we verify claims" into a measurement.
    for (const claim of brief.claims) {
      const mutation = mutateClaim(claim, rand.next)
      if (!mutation) continue
      injected++
      const mutatedReport = verifyBrief(
        [mutation.mutated],
        record,
        brief.windowStart,
        brief.windowEnd,
      )
      if (!mutatedReport.results[0].verified) caught++
    }
  }

  return {
    briefsGenerated: cohort.length,
    totalClaims,
    verifiedClaims,
    verificationRate: totalClaims > 0 ? verifiedClaims / totalClaims : 0,
    keyCoverage: keyTotal > 0 ? keyChecked / keyTotal : 0,
    mutationsInjected: injected,
    mutationsCaught: caught,
    mutationCatchRate: injected > 0 ? caught / injected : 0,
  }
}

// ---------------------------------------------------------------------------
// Experiment 5: logging burden
// ---------------------------------------------------------------------------

export interface BurdenExperiment {
  patientDays: number
  meanAdaptiveFields: number
  /** Fixed questionnaire over the patient's OWN tracked vocabulary. */
  meanStaticFields: number
  reduction: number
  /**
   * Fixed questionnaire over the full multi-domain vocabulary the app supports.
   * This is the more realistic comparator for a static instrument built to cover the
   * symptom domains the PRO literature calls for, since such an instrument cannot know
   * in advance which symptoms a given patient has.
   */
  fullVocabularyFields: number
  reductionVsFullVocabulary: number
  /** Distribution of fields presented per day under the adaptive planner. */
  adaptiveFieldHistogram: Record<number, number>
  /** Estimated seconds to complete, at a measured per-field interaction cost. */
  estimatedSecondsAdaptive: number
  estimatedSecondsStatic: number
  secondsPerFieldAssumption: number
}

/**
 * Time is ESTIMATED, not measured from users. Each presented field is costed at 3.5
 * seconds — a tap plus read time, consistent with published per-item completion costs
 * for mobile symptom diaries. This is an assumption, stated here so it can be
 * challenged, and no claim is made that real users hit these numbers.
 */
const SECONDS_PER_FIELD = 3.5

export function runBurdenExperiment(patients = 20): BurdenExperiment {
  const cohort = generateCohort({
    patients,
    days: 180,
    endDate: COHORT_END_DATE,
    missingness: { mode: 'mcar', rate: 0.1 },
    kappa: 4,
    cyclicalFraction: 0.5,
    seedPrefix: 'burden',
    symptomsPerPatient: 6,
  })

  let adaptiveTotal = 0
  let staticTotal = 0
  let dayCount = 0
  const histogram: Record<number, number> = {}

  for (const record of cohort) {
    const ctx = buildFeatureContext(record, fullWindow(record))
    // Sample every 7th day to keep the experiment quick while spanning all phases.
    for (let i = 0; i < ctx.orderedDates.length; i += 7) {
      const plan = planDailyQuestions(ctx, ctx.orderedDates[i])
      adaptiveTotal += plan.fieldCount
      staticTotal += plan.staticFieldCount
      histogram[plan.fieldCount] = (histogram[plan.fieldCount] ?? 0) + 1
      dayCount++
    }
  }

  const meanAdaptive = dayCount > 0 ? adaptiveTotal / dayCount : 0
  const meanStatic = dayCount > 0 ? staticTotal / dayCount : 0
  const fullVocabulary = 3 + SYMPTOMS.filter((s) => !s.sensitive).length

  return {
    patientDays: dayCount,
    meanAdaptiveFields: meanAdaptive,
    meanStaticFields: meanStatic,
    reduction: meanStatic > 0 ? 1 - meanAdaptive / meanStatic : 0,
    fullVocabularyFields: fullVocabulary,
    reductionVsFullVocabulary: 1 - meanAdaptive / fullVocabulary,
    adaptiveFieldHistogram: histogram,
    estimatedSecondsAdaptive: meanAdaptive * SECONDS_PER_FIELD,
    estimatedSecondsStatic: meanStatic * SECONDS_PER_FIELD,
    secondsPerFieldAssumption: SECONDS_PER_FIELD,
  }
}

// ---------------------------------------------------------------------------
// Experiment 6: latency
// ---------------------------------------------------------------------------

export interface LatencyExperiment {
  runs: number
  recordDays: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  meanMs: number
  stageBreakdownMs: { features: number; patterns: number; brief: number; fidelity: number }
}

export function runLatencyExperiment(runs = 40): LatencyExperiment {
  const [record] = generateCohort({
    patients: 1,
    days: 180,
    endDate: COHORT_END_DATE,
    missingness: { mode: 'mcar', rate: 0.1 },
    kappa: 4,
    cyclicalFraction: 0.5,
    seedPrefix: 'latency',
    symptomsPerPatient: 6,
  })
  const window = fullWindow(record)

  const totals: number[] = []
  const stages = { features: 0, patterns: 0, brief: 0, fidelity: 0 }

  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    const ctx = buildFeatureContext(record, window)
    const t1 = performance.now()
    const { findings, suppressed } = runPatternEngine(ctx)
    const t2 = performance.now()
    const brief = generateBrief(ctx, findings, suppressed)
    const t3 = performance.now()
    verifyBrief(brief.claims, record, brief.windowStart, brief.windowEnd)
    const t4 = performance.now()

    totals.push(t4 - t0)
    stages.features += t1 - t0
    stages.patterns += t2 - t1
    stages.brief += t3 - t2
    stages.fidelity += t4 - t3
  }

  return {
    runs,
    recordDays: record.days.length,
    p50Ms: quantile(totals, 0.5),
    p95Ms: quantile(totals, 0.95),
    maxMs: Math.max(...totals),
    meanMs: totals.reduce((s, v) => s + v, 0) / totals.length,
    stageBreakdownMs: {
      features: stages.features / runs,
      patterns: stages.patterns / runs,
      brief: stages.brief / runs,
      fidelity: stages.fidelity / runs,
    },
  }
}

// ---------------------------------------------------------------------------
// Full run
// ---------------------------------------------------------------------------

export interface EvaluationReport {
  generatedAt: string
  engineVersion: string
  gate: GateConfig
  detection: DetectionExperiment
  power: PowerPoint[]
  robustness: RobustnessPoint[]
  fidelity: FidelityExperiment
  burden: BurdenExperiment
  latency: LatencyExperiment
}

export const ENGINE_VERSION = '0.1.0'

export function runFullEvaluation(): EvaluationReport {
  return {
    generatedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    gate: DEFAULT_GATE,
    detection: runDetectionExperiment(),
    power: runPowerSweep(),
    robustness: runRobustnessSweep(),
    fidelity: runFidelityExperiment(),
    burden: runBurdenExperiment(),
    latency: runLatencyExperiment(),
  }
}
