/**
 * generator.ts — Synthetic patient records with known ground truth.
 *
 * The pattern engine cannot be evaluated against real patient data here, and self-
 * reported real-world data has no ground truth anyway: nobody knows whether a given
 * patient's dyschezia is "truly" cyclical. So the engine is evaluated against data
 * generated from a known process, where the answer is known by construction.
 *
 * THE CONTROLLED COMPARISON
 *
 * A naive generator would make cyclical symptoms simply more frequent than
 * non-cyclical ones, and then any detector that keys on frequency would score well
 * for the wrong reason. This generator holds *marginal prevalence* matched between
 * the two classes and varies only the *phase concentration*:
 *
 *   cyclical      p(theta) = base + amplitude * vonMises(theta | mu, kappa)
 *   non-cyclical  p        = base + amplitude * E[vonMises]   (a constant)
 *
 * where the constant is the circular mean of the same von Mises kernel. Both classes
 * therefore have the same expected number of symptom-days over a full cycle, and the
 * only thing distinguishing them is *when* in the cycle those days fall. kappa is the
 * effect-size knob: kappa = 0 is indistinguishable from non-cyclical, and larger kappa
 * means tighter perimenstrual clustering.
 *
 * Ground truth is written into `record.groundTruth`, which the pattern engine never
 * reads — enforced by a test in engine.test.ts.
 */

import { addDays, dateRange } from '../engine/cycles'
import { createRandom, vonMisesRelativeDensity, type Random } from '../engine/rng'
import {
  ImpactLevel,
  type BleedingLevel,
  type DayRecord,
  type GroundTruth,
  type PatientRecord,
  type SymptomObservation,
} from '../engine/types'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SymptomSpec {
  id: string
  /** True if occurrence is concentrated at a cycle phase. */
  cyclical: boolean
  /** von Mises concentration. Effect size. Ignored when cyclical is false. */
  kappa: number
  /** Phase centre in radians. 0 = menstrual onset (D0). */
  mu: number
  /** Occurrence probability floor. */
  baseRate: number
  /** Additional probability at the peak phase. */
  amplitude: number
  /** Change in baseRate per cycle. Positive = worsening. */
  drift?: number
  /** Probability the app asks about this symptom on a logged day (adaptive questioning). */
  askProbability?: number
  /** Mean severity when present, before any phase boost. */
  severityMean?: number
  graded?: boolean
}

export interface GeneratorConfig {
  patientId: string
  displayName: string
  seed: number | string
  /** Number of calendar days to generate. */
  days: number
  /** Last date in the record (ISO). */
  endDate: string
  meanCycleLength: number
  cycleLengthSd: number
  meanBleedDays: number
  symptoms: SymptomSpec[]
  missingness: { mode: 'mcar' | 'mar'; rate: number }
  treatments?: PatientRecord['treatments']
  clinicalEvents?: PatientRecord['clinicalEvents']
  profile?: Partial<PatientRecord['profile']>
}

// ---------------------------------------------------------------------------
// Prevalence matching
// ---------------------------------------------------------------------------

/**
 * Circular mean of the normalised von Mises kernel, E[exp(kappa*(cos(theta-mu)-1))]
 * over uniform theta. Equals I0(kappa) * exp(-kappa).
 *
 * Computed by trapezoidal quadrature on a fine grid rather than by implementing a
 * Bessel function: 720 points is far more accuracy than we need and the code stays
 * auditable by inspection.
 */
export function meanVonMisesDensity(kappa: number, steps = 720): number {
  if (kappa < 1e-6) return 1
  let sum = 0
  for (let i = 0; i < steps; i++) {
    const theta = (2 * Math.PI * i) / steps
    sum += Math.exp(kappa * (Math.cos(theta) - 1))
  }
  return sum / steps
}

/**
 * Occurrence probability for a symptom on a day at cycle phase `theta`, in cycle
 * number `cycleIndex`.
 */
export function occurrenceProbability(
  spec: SymptomSpec,
  theta: number,
  cycleIndex: number,
): number {
  const drift = (spec.drift ?? 0) * cycleIndex
  const shape = spec.cyclical
    ? vonMisesRelativeDensity(theta, spec.mu, spec.kappa)
    : meanVonMisesDensity(spec.kappa) // matched marginal prevalence, no phase structure
  return clamp01(spec.baseRate + spec.amplitude * shape + drift)
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

// ---------------------------------------------------------------------------
// Cycle scaffolding
// ---------------------------------------------------------------------------

interface GeneratedCycle {
  startIndex: number
  length: number
  bleedDays: number
}

function generateCycles(
  totalDays: number,
  meanLength: number,
  sdLength: number,
  meanBleedDays: number,
  rand: Random,
): GeneratedCycle[] {
  const cycles: GeneratedCycle[] = []
  let cursor = 0
  while (cursor < totalDays) {
    // Clipped normal: real cycles are neither 28 nor unbounded.
    const length = Math.max(21, Math.min(45, Math.round(rand.normal(meanLength, sdLength))))
    const bleedDays = Math.max(2, Math.min(9, Math.round(rand.normal(meanBleedDays, 1.2))))
    cycles.push({ startIndex: cursor, length, bleedDays })
    cursor += length
  }
  return cycles
}

const FLOW_BY_DAY: BleedingLevel[] = ['moderate', 'heavy', 'heavy', 'moderate', 'light', 'light', 'spotting', 'spotting', 'spotting']

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export function generatePatient(config: GeneratorConfig): PatientRecord {
  const rand = createRandom(config.seed)
  const startDate = addDays(config.endDate, -(config.days - 1))
  const dates = dateRange(startDate, config.endDate)

  const cycles = generateCycles(
    config.days,
    config.meanCycleLength,
    config.cycleLengthSd,
    config.meanBleedDays,
    rand,
  )

  // Map each day index to its cycle, phase angle and bleeding level.
  const dayMeta = dates.map((_, i) => {
    const cycle = cycles.find((c) => i >= c.startIndex && i < c.startIndex + c.length)!
    const dayInCycle = i - cycle.startIndex
    const theta = (2 * Math.PI * dayInCycle) / cycle.length
    const bleeding: BleedingLevel =
      dayInCycle < cycle.bleedDays ? FLOW_BY_DAY[Math.min(dayInCycle, FLOW_BY_DAY.length - 1)] : 'none'
    return {
      cycleIndex: cycles.indexOf(cycle),
      dayInCycle,
      theta,
      bleeding,
      cycleLength: cycle.length,
    }
  })

  // --- Draw the true symptom state for every day, before any missingness ---
  const trueStates: Record<string, boolean>[] = []
  const trueSeverities: Record<string, number>[] = []

  for (let i = 0; i < dates.length; i++) {
    const meta = dayMeta[i]
    const states: Record<string, boolean> = {}
    const severities: Record<string, number> = {}

    for (const spec of config.symptoms) {
      const p = occurrenceProbability(spec, meta.theta, meta.cycleIndex)
      const present = rand.bernoulli(p)
      states[spec.id] = present
      if (present) {
        // Severity rises toward the phase peak for cyclical symptoms, which is what
        // makes median severity and occurrence rate tell a consistent story.
        const boost = spec.cyclical
          ? 2.2 * vonMisesRelativeDensity(meta.theta, spec.mu, spec.kappa)
          : 0.8
        const raw = rand.normal((spec.severityMean ?? 4) + boost, 1.6)
        severities[spec.id] = Math.max(1, Math.min(10, Math.round(raw)))
      }
    }
    trueStates.push(states)
    trueSeverities.push(severities)
  }

  // --- Missingness ---
  const burdenOf = (i: number) =>
    Object.values(trueSeverities[i]).reduce((s, v) => s + v, 0)
  const maxBurden = Math.max(1, ...dates.map((_, i) => burdenOf(i)))

  const days: DayRecord[] = dates.map((date, i) => {
    const meta = dayMeta[i]

    let missProbability = config.missingness.rate
    if (config.missingness.mode === 'mar') {
      // MAR, in the adversarial direction: the worse the day, the more likely the
      // patient is too unwell or too preoccupied to log it. This preferentially
      // removes menstrual-window days and therefore *attenuates* the very signal the
      // cyclicity detector is looking for.
      //
      // Note that this does NOT preserve the marginal missingness rate: because most
      // days carry below-peak burden, the multiplier averages well under 1 and a given
      // `rate` yields less total missingness under MAR than under MCAR. MCAR and MAR
      // runs are therefore only comparable at matched *coverage*, not at matched
      // `rate`, and the evaluation report indexes the comparison by coverage.
      const relative = burdenOf(i) / maxBurden
      missProbability = clamp01(config.missingness.rate * (0.4 + 1.2 * relative))
    }

    if (rand.bernoulli(missProbability)) {
      return { date, logged: false, symptoms: {} }
    }

    // --- Logged day: adaptive questioning leaves some symptoms `unknown` ---
    const symptoms: Record<string, SymptomObservation> = {}
    let maxSeverity = 0

    for (const spec of config.symptoms) {
      const asked = rand.bernoulli(spec.askProbability ?? 0.9)
      if (!asked) continue // absent from the record entirely -> `unknown`, not `absent`

      const present = trueStates[i][spec.id]
      if (present) {
        const severity = trueSeverities[i][spec.id]
        symptoms[spec.id] =
          spec.graded === false ? { state: 'present' } : { state: 'present', severity }
        maxSeverity = Math.max(maxSeverity, severity)
      } else {
        symptoms[spec.id] = { state: 'absent' }
      }
    }

    // --- Functional impact, driven by the worst symptom of the day ---
    let impact: ImpactLevel = ImpactLevel.None
    if (maxSeverity >= 8) impact = rand.bernoulli(0.55) ? ImpactLevel.CouldNotPerform : ImpactLevel.ModifiedActivities
    else if (maxSeverity >= 6) impact = rand.bernoulli(0.6) ? ImpactLevel.ModifiedActivities : ImpactLevel.Slight
    else if (maxSeverity >= 3) impact = rand.bernoulli(0.5) ? ImpactLevel.Slight : ImpactLevel.None

    const impactDomains: string[] = []
    if (impact >= ImpactLevel.ModifiedActivities) {
      const pool = ['work', 'education', 'exercise', 'sleep', 'household', 'social', 'concentration']
      const n = rand.int(1, 3)
      for (let k = 0; k < n; k++) {
        const pick = rand.pick(pool)
        if (!impactDomains.includes(pick)) impactDomains.push(pick)
      }
    }

    // --- Medication, more likely on worse days ---
    const medications =
      maxSeverity >= 5 && rand.bernoulli(0.6)
        ? [
            {
              medicationId: rand.bernoulli(0.7) ? 'ibuprofen' : 'paracetamol',
              label: rand.bernoulli(0.7) ? 'Ibuprofen' : 'Paracetamol',
              dose: '400 mg',
              perceivedRelief: rand.int(2, 8),
            },
          ]
        : undefined

    return {
      date,
      logged: true,
      bleeding: meta.bleeding,
      impact,
      impactDomains: impactDomains.length > 0 ? impactDomains : undefined,
      symptoms,
      medications,
      depth: maxSeverity >= 7 ? 'detailed' : 'standard',
    }
  })

  const groundTruth: GroundTruth = {
    seed: typeof config.seed === 'number' ? config.seed : 0,
    symptoms: Object.fromEntries(
      config.symptoms.map((s) => [
        s.id,
        {
          cyclical: s.cyclical,
          kappa: s.cyclical ? s.kappa : 0,
          mu: s.mu,
          baseRate: s.baseRate,
          drift: s.drift ?? 0,
          worsening: (s.drift ?? 0) >= 0.02,
        },
      ]),
    ),
    missingness: config.missingness,
  }

  return {
    profile: {
      id: config.patientId,
      displayName: config.displayName,
      diagnosisStatus: 'suspected',
      enabledDomains: ['pain', 'bowel', 'urinary', 'systemic'],
      ...config.profile,
    },
    days,
    treatments: config.treatments ?? [],
    clinicalEvents: config.clinicalEvents ?? [],
    trackedSymptomIds: config.symptoms.map((s) => s.id),
    groundTruth,
  }
}

// ---------------------------------------------------------------------------
// Cohort generation for the evaluation harness
// ---------------------------------------------------------------------------

export interface CohortConfig {
  patients: number
  days: number
  endDate: string
  missingness: { mode: 'mcar' | 'mar'; rate: number }
  /** Concentration for the cyclical half of the cohort. */
  kappa: number
  /** Probability a given symptom in a given patient is generated as cyclical. */
  cyclicalFraction: number
  seedPrefix: string
  /** Symptoms per patient. */
  symptomsPerPatient?: number
  /**
   * Hold expected per-day occurrence probability constant at this value, by solving
   * for the amplitude that achieves it at the given kappa.
   *
   * Necessary for any sweep over kappa. The normalised von Mises kernel has mean
   * I0(k)*exp(-k), which FALLS as k rises, so with a fixed amplitude a higher kappa
   * silently produces fewer symptom-days. Effect size and sample size would then move
   * together and the sweep would not isolate either. Setting this makes kappa a clean
   * effect-size axis.
   */
  targetPrevalence?: number
}

/** Symptom slots used by the cohort, with plausible but varied baseline behaviour. */
const COHORT_SYMPTOM_POOL = [
  { id: 'pelvic_pain', baseRate: 0.1, amplitude: 0.55, severityMean: 5 },
  { id: 'painful_bm', baseRate: 0.05, amplitude: 0.5, severityMean: 4 },
  { id: 'bloating', baseRate: 0.14, amplitude: 0.4, severityMean: 4 },
  { id: 'fatigue', baseRate: 0.18, amplitude: 0.35, severityMean: 4 },
  { id: 'lower_back_pain', baseRate: 0.08, amplitude: 0.45, severityMean: 4 },
  { id: 'nausea', baseRate: 0.05, amplitude: 0.35, severityMean: 3 },
  { id: 'headache', baseRate: 0.1, amplitude: 0.3, severityMean: 4 },
  { id: 'bladder_pain', baseRate: 0.04, amplitude: 0.35, severityMean: 4 },
]

export function generateCohort(config: CohortConfig): PatientRecord[] {
  const out: PatientRecord[] = []
  const perPatient = config.symptomsPerPatient ?? 4

  for (let i = 0; i < config.patients; i++) {
    const rand = createRandom(`${config.seedPrefix}:assign:${i}`)

    // Rotate the starting offset so symptom identity is not confounded with class.
    const offset = i % COHORT_SYMPTOM_POOL.length
    const chosen = Array.from({ length: perPatient }, (_, k) => COHORT_SYMPTOM_POOL[(offset + k) % COHORT_SYMPTOM_POOL.length])

    const symptoms: SymptomSpec[] = chosen.map((base) => {
      const cyclical = rand.next() < config.cyclicalFraction

      // Solve amplitude for the requested mean prevalence at this kappa, so that
      // sweeping kappa varies phase concentration and nothing else.
      const amplitude =
        config.targetPrevalence !== undefined
          ? Math.max(
              0,
              (config.targetPrevalence - base.baseRate) / meanVonMisesDensity(config.kappa),
            )
          : base.amplitude

      return {
        ...base,
        amplitude,
        cyclical,
        kappa: config.kappa,
        // Peak just before onset, the characteristic perimenstrual pattern, with a
        // little between-patient variation so mu is not a constant the engine could
        // exploit.
        mu: (2 * Math.PI * rand.int(-2, 2)) / 29,
        drift: 0,
        askProbability: 0.92,
      }
    })

    out.push(
      generatePatient({
        patientId: `cohort-${config.seedPrefix}-${i}`,
        displayName: `Synthetic ${i}`,
        seed: `${config.seedPrefix}:patient:${i}`,
        days: config.days,
        endDate: config.endDate,
        meanCycleLength: 27 + rand.int(0, 5),
        cycleLengthSd: 2.5,
        meanBleedDays: 5,
        symptoms,
        missingness: config.missingness,
      }),
    )
  }

  return out
}
