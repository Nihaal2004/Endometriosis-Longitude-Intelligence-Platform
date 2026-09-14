/**
 * fidelity.ts — Independent verification of every claim in the brief.
 *
 * WHY THIS FILE DUPLICATES WORK ON PURPOSE
 *
 * The brief's numbers come from features.ts via patterns.ts. If this checker simply
 * re-read those same cached features, it would verify nothing: any bug in the feature
 * layer would be faithfully reproduced on both sides and the check would always pass.
 *
 * So this module deliberately re-derives everything from `record.days` using a
 * *separately written* implementation — its own bleeding-onset scan, its own
 * menstrual-window rule, its own counting loops. The duplication is the mechanism. A
 * disagreement between the two paths means at least one of them is wrong, and the
 * claim is dropped rather than shown.
 *
 * Its effectiveness is measured, not assumed: the evaluation harness injects numeric
 * mutations into generated claims and reports what fraction this checker catches.
 */

import { addDays, daysBetween, DEFAULT_CYCLE_CONFIG, type CycleConfig } from './cycles'
import { SEVERE_THRESHOLD } from './features'
import {
  BLEEDING_FLOW_LEVELS,
  ImpactLevel,
  type Claim,
  type DayRecord,
  type PatientRecord,
} from './types'

export interface VerificationResult {
  claimId: string
  verified: boolean
  /** Keys that were independently recomputed and matched. */
  checkedKeys: string[]
  /** Keys with no independent recomputation rule. */
  unverifiableKeys: string[]
  mismatches: { key: string; asserted: number; recomputed: number }[]
}

export interface FidelityReport {
  results: VerificationResult[]
  totalClaims: number
  verifiedClaims: number
  totalKeys: number
  checkedKeys: number
  mismatchedKeys: number
  /** checkedKeys / totalKeys — how much of the brief is independently confirmed. */
  keyCoverage: number
}

// ---------------------------------------------------------------------------
// Independent re-derivation of cycle structure
// ---------------------------------------------------------------------------

function isFlowDay(day: DayRecord): boolean {
  return day.bleeding !== undefined && BLEEDING_FLOW_LEVELS.includes(day.bleeding)
}

/**
 * Bleeding onsets, re-derived independently.
 *
 * Written differently from cycles.ts on purpose: this filters to logged days first and
 * then walks that array, rather than walking all calendar days and carrying a flag.
 * Same semantics, different code path.
 */
export function independentOnsets(
  days: DayRecord[],
  config: CycleConfig = DEFAULT_CYCLE_CONFIG,
): string[] {
  const loggedDays = days
    .filter((d) => d.logged)
    .sort((a, b) => a.date.localeCompare(b.date))

  const onsets: string[] = []
  for (let i = 0; i < loggedDays.length; i++) {
    if (!isFlowDay(loggedDays[i])) continue
    const previousLoggedWasFlow = i > 0 && isFlowDay(loggedDays[i - 1])
    if (previousLoggedWasFlow) continue // mid-run, not an onset

    const last = onsets[onsets.length - 1]
    if (last === undefined || daysBetween(last, loggedDays[i].date) >= config.minCycleGapDays) {
      onsets.push(loggedDays[i].date)
    }
  }
  return onsets
}

/**
 * The set of dates falling in a menstrual window, re-derived by direct expansion
 * around each onset rather than via signed cycle-day arithmetic.
 *
 * A date is perimenstrual if it is within `windowAfter` days *after* an onset, or
 * within `windowBefore` days *before* one. This is the same set the signed-cycle-day
 * rule in cycles.ts produces, reached by a different route.
 */
export function independentMenstrualWindow(
  onsets: string[],
  config: CycleConfig = DEFAULT_CYCLE_CONFIG,
): Set<string> {
  const window = new Set<string>()
  for (const onset of onsets) {
    for (let d = -config.windowBefore; d <= config.windowAfter; d++) {
      window.add(addDays(onset, d))
    }
  }
  return window
}

interface IndependentScope {
  /** Dates eligible for analysis: inside the window AND inside a recorded cycle. */
  dates: string[]
  menstrual: Set<string>
  byDate: Map<string, DayRecord>
}

function buildScope(
  record: PatientRecord,
  windowStart: string,
  windowEnd: string,
  config: CycleConfig,
): IndependentScope {
  const onsets = independentOnsets(record.days, config)
  const menstrual = independentMenstrualWindow(onsets, config)

  const byDate = new Map<string, DayRecord>()
  for (const day of record.days) byDate.set(day.date, day)

  const lastRecordDate = record.days.length > 0
    ? record.days.map((d) => d.date).sort()[record.days.length - 1]
    : windowEnd
  const firstOnset = onsets[0]

  // Days before the first recorded onset have no cycle position at all and are
  // excluded from cycle-relative denominators, exactly as alignToCycles excludes them.
  const dates: string[] = []
  const n = daysBetween(windowStart, windowEnd)
  for (let i = 0; i <= n; i++) {
    const date = addDays(windowStart, i)
    if (firstOnset !== undefined && date >= firstOnset && date <= lastRecordDate) {
      dates.push(date)
    }
  }

  return { dates, menstrual, byDate }
}

// ---------------------------------------------------------------------------
// Recomputation rules
// ---------------------------------------------------------------------------

type Recomputer = (scope: IndependentScope, symptomId: string) => number

/** present/absent/unknown, read straight off the raw record. */
function stateOf(scope: IndependentScope, date: string, symptomId: string): 'present' | 'absent' | 'unknown' {
  const day = scope.byDate.get(date)
  if (!day || !day.logged) return 'unknown'
  return day.symptoms[symptomId]?.state ?? 'unknown'
}

function countBy(
  scope: IndependentScope,
  symptomId: string,
  wantMenstrual: boolean | null,
  wantPresent: boolean,
): number {
  let n = 0
  for (const date of scope.dates) {
    if (wantMenstrual !== null && scope.menstrual.has(date) !== wantMenstrual) continue
    const state = stateOf(scope, date, symptomId)
    if (state === 'unknown') continue
    if (wantPresent) {
      if (state === 'present') n++
    } else {
      n++ // observed (present or absent)
    }
  }
  return n
}

const SYMPTOM_RULES: Record<string, Recomputer> = {
  menstrualPresent: (s, id) => countBy(s, id, true, true),
  menstrualObserved: (s, id) => countBy(s, id, true, false),
  nonMenstrualPresent: (s, id) => countBy(s, id, false, true),
  nonMenstrualObserved: (s, id) => countBy(s, id, false, false),
  menstrualRatePct: (s, id) => {
    const obs = countBy(s, id, true, false)
    return obs === 0 ? 0 : Math.round((countBy(s, id, true, true) / obs) * 100)
  },
  nonMenstrualRatePct: (s, id) => {
    const obs = countBy(s, id, false, false)
    return obs === 0 ? 0 : Math.round((countBy(s, id, false, true) / obs) * 100)
  },
  riskRatio: (s, id) => {
    const mwObs = countBy(s, id, true, false)
    const nonObs = countBy(s, id, false, false)
    let a = countBy(s, id, true, true)
    let c = countBy(s, id, false, true)
    let n1 = mwObs
    let n2 = nonObs
    if (a === 0 || c === 0 || a === n1 || c === n2) {
      a += 0.5
      c += 0.5
      n1 += 1
      n2 += 1
    }
    if (n1 === 0 || n2 === 0 || c === 0) return 0
    return Math.round((a / n1 / (c / n2)) * 10) / 10
  },
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/** Extract the symptom id a claim is about from its finding id. */
function symptomIdOf(claim: Claim): string | undefined {
  const parts = claim.findingId.split(':')
  if (parts.length < 2) return undefined
  return parts[1]
}

/** Numbers are compared with a tolerance to absorb display rounding, not real error. */
function matches(asserted: number, recomputed: number): boolean {
  if (Number.isInteger(asserted) && Number.isInteger(recomputed)) {
    return asserted === recomputed
  }
  return Math.abs(asserted - recomputed) <= 0.1 + Math.abs(recomputed) * 1e-9
}

export function verifyClaim(
  claim: Claim,
  record: PatientRecord,
  windowStart: string,
  windowEnd: string,
  config: CycleConfig = DEFAULT_CYCLE_CONFIG,
): VerificationResult {
  const scope = buildScope(record, windowStart, windowEnd, config)
  const symptomId = symptomIdOf(claim)

  const checkedKeys: string[] = []
  const unverifiableKeys: string[] = []
  const mismatches: VerificationResult['mismatches'] = []

  for (const [key, asserted] of Object.entries(claim.assertedValues)) {
    const recomputed = recompute(key, claim, scope, record, symptomId, windowStart, windowEnd)
    if (recomputed === null) {
      unverifiableKeys.push(key)
      continue
    }
    checkedKeys.push(key)
    if (!matches(asserted, recomputed)) {
      mismatches.push({ key, asserted, recomputed })
    }
  }

  // A claim also fails if any of its evidence dates is not a real logged day. That
  // closes the loop on traceability: the clinician can click through to every date.
  let evidenceValid = true
  for (const date of claim.evidenceDates) {
    const day = scope.byDate.get(date)
    if (!day || !day.logged) {
      evidenceValid = false
      break
    }
  }

  return {
    claimId: claim.id,
    verified: mismatches.length === 0 && evidenceValid,
    checkedKeys,
    unverifiableKeys,
    mismatches,
  }
}

function recompute(
  key: string,
  claim: Claim,
  scope: IndependentScope,
  record: PatientRecord,
  symptomId: string | undefined,
  windowStart: string,
  windowEnd: string,
): number | null {
  // --- Symptom-scoped rules ---
  if (symptomId && SYMPTOM_RULES[key]) {
    return SYMPTOM_RULES[key](scope, symptomId)
  }

  // --- Record-scoped rules ---
  switch (key) {
    case 'calendarDays':
      return daysBetween(windowStart, windowEnd) + 1

    case 'loggedDays': {
      let n = 0
      for (let i = 0; i <= daysBetween(windowStart, windowEnd); i++) {
        if (scope.byDate.get(addDays(windowStart, i))?.logged) n++
      }
      return n
    }

    case 'coveragePct': {
      const total = daysBetween(windowStart, windowEnd) + 1
      let n = 0
      for (let i = 0; i < total; i++) {
        if (scope.byDate.get(addDays(windowStart, i))?.logged) n++
      }
      return total === 0 ? 0 : Math.round((n / total) * 100)
    }

    case 'completeCycles':
      return Math.max(0, independentOnsets(record.days).length - 1)

    case 'limitingDays':
      return countImpact(scope, (i) => i >= ImpactLevel.ModifiedActivities)

    case 'couldNotPerformDays':
      return countImpact(scope, (i) => i === ImpactLevel.CouldNotPerform)

    case 'daysWithMedication': {
      let n = 0
      for (const date of scope.dates) {
        const day = scope.byDate.get(date)
        if (day?.logged && (day.medications?.length ?? 0) > 0) n++
      }
      return n
    }

    case 'severeDespiteMedication': {
      let n = 0
      for (const date of scope.dates) {
        const day = scope.byDate.get(date)
        if (!day?.logged || (day.medications?.length ?? 0) === 0) continue
        const severe = Object.values(day.symptoms).some(
          (o) => o.state === 'present' && (o.severity ?? 0) >= SEVERE_THRESHOLD,
        )
        if (severe) n++
      }
      return n
    }

    case 'bothPresent':
    case 'pairedDays': {
      const parts = claim.findingId.split(':')
      if (parts.length < 3) return null
      const [, a, b] = parts
      let both = 0
      let paired = 0
      for (const date of scope.dates) {
        const sa = stateOf(scope, date, a)
        const sb = stateOf(scope, date, b)
        if (sa === 'unknown' || sb === 'unknown') continue
        paired++
        if (sa === 'present' && sb === 'present') both++
      }
      return key === 'bothPresent' ? both : paired
    }

    default:
      // Statistics that are functions of already-verified counts (p-values, kappa,
      // Theil-Sen slopes, confidence bounds) are not re-derived here. They are
      // deterministic functions of inputs this checker has already confirmed, and
      // re-implementing each test a second time would verify the arithmetic rather
      // than the data. The report states how many keys this applies to.
      return null
  }
}

function countImpact(scope: IndependentScope, predicate: (i: ImpactLevel) => boolean): number {
  let n = 0
  for (const date of scope.dates) {
    const day = scope.byDate.get(date)
    if (!day?.logged || day.impact === undefined) continue
    if (predicate(day.impact)) n++
  }
  return n
}

// ---------------------------------------------------------------------------
// Whole-brief verification
// ---------------------------------------------------------------------------

export function verifyBrief(
  claims: Claim[],
  record: PatientRecord,
  windowStart: string,
  windowEnd: string,
  config: CycleConfig = DEFAULT_CYCLE_CONFIG,
): FidelityReport {
  const results = claims.map((c) => verifyClaim(c, record, windowStart, windowEnd, config))

  let totalKeys = 0
  let checkedKeys = 0
  let mismatchedKeys = 0
  for (const r of results) {
    totalKeys += r.checkedKeys.length + r.unverifiableKeys.length
    checkedKeys += r.checkedKeys.length
    mismatchedKeys += r.mismatches.length
  }

  return {
    results,
    totalClaims: claims.length,
    verifiedClaims: results.filter((r) => r.verified).length,
    totalKeys,
    checkedKeys,
    mismatchedKeys,
    keyCoverage: totalKeys === 0 ? 0 : checkedKeys / totalKeys,
  }
}

/** Drop any claim that failed verification, and report what was removed. */
export function applyFidelityGate(
  claims: Claim[],
  report: FidelityReport,
): { kept: Claim[]; rejected: Claim[] } {
  const byId = new Map(report.results.map((r) => [r.claimId, r]))
  const kept: Claim[] = []
  const rejected: Claim[] = []

  for (const claim of claims) {
    const result = byId.get(claim.id)
    const ok = result?.verified ?? false
    const annotated: Claim = {
      ...claim,
      verified: ok,
      verificationError: result?.mismatches.length
        ? result.mismatches
            .map((m) => `${m.key}: brief says ${m.asserted}, recomputed ${m.recomputed}`)
            .join('; ')
        : undefined,
    }
    if (ok) kept.push(annotated)
    else rejected.push(annotated)
  }

  return { kept, rejected }
}

// ---------------------------------------------------------------------------
// Numeric-token check for the optional LLM polish path
// ---------------------------------------------------------------------------

/** Every number appearing in a string, including decimals and percentages. */
export function extractNumbers(text: string): number[] {
  const matches = text.match(/-?\d+(?:\.\d+)?/g)
  return matches ? matches.map(Number) : []
}

/**
 * Gate for LLM-rewritten prose.
 *
 * A polished sentence may change any word but no number: every numeric token in the
 * rewrite must already appear in the claim's asserted values (or in the original
 * sentence, which covers p-value digits and CI bounds). Anything else means the model
 * invented, dropped or altered a figure, and the rewrite is discarded in favour of the
 * deterministic original.
 */
export function verifyPolishedText(original: Claim, polished: string): boolean {
  const allowed = new Set<number>()
  for (const v of Object.values(original.assertedValues)) allowed.add(v)
  for (const n of extractNumbers(original.text)) allowed.add(n)

  for (const n of extractNumbers(polished)) {
    let found = false
    for (const a of allowed) {
      if (Math.abs(a - n) < 1e-9) {
        found = true
        break
      }
    }
    if (!found) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Mutation testing support
// ---------------------------------------------------------------------------

/**
 * Corrupt exactly one verifiable number in a claim, for mutation testing.
 *
 * Only keys the checker actually has a rule for are mutated — mutating a p-value the
 * checker openly does not re-derive would measure nothing and would inflate the
 * reported catch rate. Returns null if the claim has no verifiable key.
 */
export function mutateClaim(
  claim: Claim,
  nextRandom: () => number,
): { mutated: Claim; key: string; from: number; to: number } | null {
  const verifiableKeys = Object.keys(claim.assertedValues).filter(
    (k) => k in SYMPTOM_RULES || RECORD_VERIFIABLE_KEYS.has(k),
  )
  if (verifiableKeys.length === 0) return null

  const key = verifiableKeys[Math.floor(nextRandom() * verifiableKeys.length)]
  const from = claim.assertedValues[key]

  // A realistic corruption: an off-by-a-few error of the kind a mis-wired template or
  // a hallucinated figure would produce, never a no-op.
  const delta = Math.max(1, Math.round(Math.abs(from) * 0.2)) * (nextRandom() < 0.5 ? -1 : 1)
  const to = from + delta

  const mutatedText = claim.text.replace(String(from), String(to))

  return {
    mutated: {
      ...claim,
      text: mutatedText,
      assertedValues: { ...claim.assertedValues, [key]: to },
    },
    key,
    from,
    to,
  }
}

const RECORD_VERIFIABLE_KEYS = new Set([
  'calendarDays',
  'loggedDays',
  'coveragePct',
  'completeCycles',
  'limitingDays',
  'couldNotPerformDays',
  'daysWithMedication',
  'severeDespiteMedication',
  'bothPresent',
  'pairedDays',
])
