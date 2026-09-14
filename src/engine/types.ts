/**
 * types.ts — The observation model.
 *
 * The central design rule of this file is the tri-state: a symptom on a given day is
 * `present`, `absent`, or `unknown`. There is no fourth state and no default. A day
 * the patient did not log is `unknown` for every symptom, and `unknown` is excluded
 * from every denominator in the feature engine — it is never silently read as zero.
 *
 * This is what separates the model from a consumer tracker, where an empty calendar
 * cell is visually indistinguishable from a recorded "no symptom".
 */

export type TriState = 'present' | 'absent' | 'unknown'

export type BleedingLevel =
  | 'none'
  | 'spotting'
  | 'light'
  | 'moderate'
  | 'heavy'
  | 'very_heavy'

/** Ordered for comparison; index doubles as an ordinal intensity score. */
export const BLEEDING_LEVELS: BleedingLevel[] = [
  'none',
  'spotting',
  'light',
  'moderate',
  'heavy',
  'very_heavy',
]

/** Levels that count as menstrual bleeding for cycle segmentation. Spotting does not. */
export const BLEEDING_FLOW_LEVELS: BleedingLevel[] = [
  'light',
  'moderate',
  'heavy',
  'very_heavy',
]

/**
 * Functional impact, deliberately a 4-level ordinal rather than a 0-10 scale.
 * The literature (ESD/EIS, and the core-outcome work) supports separating symptom
 * severity from life impact; a short ordinal keeps the daily question to one tap.
 */
export enum ImpactLevel {
  None = 0,
  Slight = 1,
  ModifiedActivities = 2,
  CouldNotPerform = 3,
}

export const IMPACT_LABELS: Record<ImpactLevel, string> = {
  [ImpactLevel.None]: 'No interference',
  [ImpactLevel.Slight]: 'A little',
  [ImpactLevel.ModifiedActivities]: 'Had to change activities',
  [ImpactLevel.CouldNotPerform]: 'Could not do something important',
}

export type SymptomDomain =
  | 'pain'
  | 'bowel'
  | 'urinary'
  | 'systemic'
  | 'sexual'
  | 'extrapelvic'

export interface SymptomDefinition {
  id: string
  label: string
  /** Clinical term surfaced in the clinician brief, where it differs from the patient label. */
  clinicalTerm?: string
  domain: SymptomDomain
  /** Severity is meaningful for this symptom (pain-like); otherwise presence only. */
  graded: boolean
  /** Hidden behind "add another symptom" rather than shown by default. */
  rare?: boolean
  /** Belongs to an optional module the patient can switch off entirely. */
  sensitive?: boolean
}

export interface SymptomObservation {
  state: TriState
  /** 0-10, only meaningful when state === 'present' and the definition is graded. */
  severity?: number
}

export interface MedicationEntry {
  medicationId: string
  label: string
  dose?: string
  /** Patient-rated relief, 0-10, captured only during detailed episodes. */
  perceivedRelief?: number
}

/**
 * One calendar day. `logged: false` means no entry exists — every symptom is
 * `unknown` and the day contributes to no denominator anywhere.
 */
export interface DayRecord {
  date: string // ISO yyyy-mm-dd
  logged: boolean
  bleeding?: BleedingLevel
  impact?: ImpactLevel
  impactDomains?: string[]
  symptoms: Record<string, SymptomObservation>
  medications?: MedicationEntry[]
  note?: string
  /** Which of the three logging depths produced this record. */
  depth?: 'quick' | 'standard' | 'detailed'
}

export interface Cycle {
  index: number
  /** D0 — first day of the bleeding run that opens this cycle. */
  startDate: string
  /** Last day before the next cycle's D0. */
  endDate: string
  lengthDays: number
  bleedDays: number
  /** False for the trailing cycle, which has no observed next onset. */
  complete: boolean
}

/**
 * A day positioned within the cycle.
 *
 * `dayInCycle` counts forward from D0. `signedCycleDay` reports the same day relative
 * to the *nearest* menstrual onset, so late-luteal days read as negative (D-2 = two
 * days before the next period). `phaseAngle` maps the day to its proportional
 * position within its own cycle — this is what makes the circular tests independent
 * of any assumed 28-day length.
 */
export interface CycleDay {
  date: string
  cycleIndex: number
  dayInCycle: number
  signedCycleDay: number
  phaseAngle: number
  cycleLength: number
  inMenstrualWindow: boolean
}

export type TreatmentKind =
  | 'combined_oral_contraceptive'
  | 'progestin'
  | 'gnrh'
  | 'iud'
  | 'physiotherapy'
  | 'pain_management'
  | 'surgery'
  | 'fertility'
  | 'other'

export interface TreatmentEpisode {
  id: string
  kind: TreatmentKind
  label: string
  startDate: string
  endDate?: string
  dose?: string
  reason?: string
  /**
   * The symptom this treatment was actually prescribed for.
   *
   * This makes the before/after comparison for that symptom a *pre-specified primary
   * question*, tested in its own family, while every other symptom is exploratory and
   * corrected together. Without the distinction, a genuine response in the indication
   * symptom is penalised by however many unrelated symptoms the patient happens to
   * track — which is both statistically the wrong family and clinically backwards.
   */
  indicationSymptomId?: string
  sideEffects?: string[]
  patientPerceivedChange?: 'better' | 'unchanged' | 'worse' | 'unsure'
}

export type ClinicalEventKind =
  | 'gp'
  | 'gynaecology'
  | 'emergency'
  | 'referral'
  | 'ultrasound'
  | 'mri'
  | 'ct'
  | 'laparoscopy'
  | 'surgery'
  | 'diagnosis'
  | 'fertility'
  | 'admission'

export interface ClinicalEvent {
  id: string
  kind: ClinicalEventKind
  date: string
  label: string
  reason?: string
  outcome?: string
  note?: string
}

export interface PatientProfile {
  id: string
  displayName: string
  ageRange?: string
  diagnosisStatus: 'suspected' | 'confirmed' | 'undiagnosed'
  symptomOnsetYear?: number
  familyHistory?: boolean
  previousPelvicSurgery?: boolean
  priorLabels?: string[]
  usualCycleLength?: [number, number]
  cycleRegularity?: 'regular' | 'variable' | 'highly_irregular'
  ageAtMenarche?: number
  /** Optional modules the patient has switched on. */
  enabledDomains: SymptomDomain[]
}

export interface PatientRecord {
  profile: PatientProfile
  days: DayRecord[]
  treatments: TreatmentEpisode[]
  clinicalEvents: ClinicalEvent[]
  /** Symptoms this patient tracks, in addition to the defaults. */
  trackedSymptomIds: string[]
  /**
   * Ground-truth generative labels. Present only on synthetic records produced by
   * data/generator.ts, and consumed only by the evaluation harness. The pattern
   * engine never reads this field — asserted by a test.
   */
  groundTruth?: GroundTruth
}

export interface GroundTruth {
  seed: number
  symptoms: Record<
    string,
    {
      /** Occurrence concentrated at a cycle phase (kappa > 0) or phase-independent. */
      cyclical: boolean
      /** von Mises concentration used to generate it; 0 for non-cyclical. */
      kappa: number
      /** Phase the occurrences were centred on, in radians. */
      mu: number
      /** Baseline per-day occurrence probability at the trough. */
      baseRate: number
      /** Monotone drift in occurrence probability per cycle. */
      drift: number
      worsening: boolean
    }
  >
  missingness: { mode: 'mcar' | 'mar'; rate: number }
}

// ---------------------------------------------------------------------------
// Derived layer
// ---------------------------------------------------------------------------

/** The per-symptom feature catalogue. Every value here is computed, never entered. */
export interface SymptomFeatures {
  symptomId: string
  /** Days with a recorded observation (present or absent). Excludes `unknown`. */
  observedDays: number
  daysPresent: number
  /** Present-days with severity >= 7. */
  severeDays: number
  medianSeverity: number | null
  maxSeverity: number | null
  /** Present / observed, within the menstrual window. */
  menstrualWindowRate: number
  menstrualWindowObserved: number
  menstrualWindowPresent: number
  nonMenstrualRate: number
  nonMenstrualObserved: number
  nonMenstrualPresent: number
  /** Cycles in which the symptom appeared at least once. */
  cyclesWithSymptom: number
  cyclesObserved: number
  /** Present-days that also carried impact >= ModifiedActivities. */
  impactDays: number
  medicationDays: number
  /** Observed days / calendar days in window. */
  coverage: number
  /** Per-cycle occurrence rate, ordered oldest to newest. Used for trend. */
  perCycleRates: number[]
}

export type PatternKind =
  | 'cyclicity'
  | 'persistence'
  | 'trend'
  | 'co_occurrence'
  | 'functional_burden'
  | 'treatment_response'
  | 'baseline_change'

/** Why a finding was suppressed rather than shown. */
export type GateReason =
  | 'insufficient_coverage'
  | 'insufficient_cycles'
  | 'insufficient_events'
  | 'not_significant'

export interface StatisticalTest {
  name: string
  statistic?: number
  p: number
  /** Benjamini-Hochberg adjusted p-value across all tests for this patient. */
  q?: number
}

export interface EffectSize {
  label: string
  value: number
  ci?: { low: number; high: number }
  unit?: string
}

/**
 * A finding is the only thing the brief generator is allowed to speak about. It
 * carries its own evidence: which days produced it, what test was run, how much data
 * backed it, and whether it passed the gate.
 */
export interface Finding {
  id: string
  kind: PatternKind
  /**
   * The multiplicity family this test belongs to. Defaults to `kind`. Set explicitly
   * where one pattern class contains both pre-specified and exploratory hypotheses,
   * so the two are corrected separately.
   */
  familyKey?: string
  symptomId?: string
  secondarySymptomId?: string
  /** Machine-readable numbers the brief renders. Never authored by a language model. */
  values: Record<string, number>
  test?: StatisticalTest
  effect?: EffectSize
  coverage: number
  observedDays: number
  /** Dates that contributed the positive observations. The audit trail. */
  evidenceDates: string[]
  passed: boolean
  gateReason?: GateReason
}

/** One sentence of the clinician brief, bound to the finding that licenses it. */
export interface Claim {
  id: string
  findingId: string
  section: BriefSection
  /** Rendered sentence. */
  text: string
  /** The numeric tokens appearing in `text`, for the fidelity checker to re-verify. */
  assertedValues: Record<string, number>
  evidenceDates: string[]
  /** Set by fidelity.ts after independent recomputation. */
  verified?: boolean
  verificationError?: string
}

export type BriefSection =
  | 'period'
  | 'concerns'
  | 'findings'
  | 'impact'
  | 'medication'
  | 'change'
  | 'quality'

export interface ConsultationBrief {
  patientId: string
  generatedAt: string
  windowStart: string
  windowEnd: string
  calendarDays: number
  loggedDays: number
  cycles: number
  claims: Claim[]
  findings: Finding[]
  suppressed: Finding[]
}
