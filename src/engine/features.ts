/**
 * features.ts — The derived-feature layer.
 *
 * Turns raw day records into the per-symptom feature catalogue that the pattern
 * engine tests and the brief reports. Nothing here is entered by a patient and
 * nothing here is produced by a language model.
 *
 * The invariant that governs every function in this file:
 *
 *     A day contributes to a denominator only if that symptom's state on that day is
 *     'present' or 'absent'. 'unknown' days are excluded everywhere.
 *
 * This is why `observedDays` is tracked separately from calendar days, and why every
 * rate is reported alongside the `n` it was computed from. A symptom observed on 8 of
 * 9 asked days is not the same evidence as 8 of 90, and the brief must never let those
 * two look alike.
 */

import { alignToCycles, dateRange, DEFAULT_CYCLE_CONFIG, segmentCycles, type CycleConfig } from './cycles'
import { median } from './stats'
import {
  ImpactLevel,
  type Cycle,
  type CycleDay,
  type DayRecord,
  type PatientRecord,
  type SymptomFeatures,
  type TriState,
} from './types'

/** Severity at or above this counts as a "severe day" in the brief. */
export const SEVERE_THRESHOLD = 7

/** Impact at or above this counts as an "activity-limiting day". */
export const LIMITING_IMPACT = ImpactLevel.ModifiedActivities

export interface AnalysisWindow {
  start: string
  end: string
}

/**
 * Everything the pattern engine needs, computed once per patient per window.
 * Building this eagerly keeps the detectors pure and makes the fidelity checker's
 * independent recomputation a genuinely separate path (it re-reads `days`, not this).
 */
export interface FeatureContext {
  record: PatientRecord
  window: AnalysisWindow
  config: CycleConfig
  /**
   * All cycles segmented from the FULL record. Used for alignment, because a window
   * that opens mid-cycle still needs to know where that cycle actually began.
   */
  cycles: Cycle[]
  /**
   * Cycles whose onset falls inside the analysis window — the cycles this window's
   * data actually covers.
   *
   * Reporting must use this, never `cycles`. A 92-day window over a 188-day record
   * contains about three cycles, and quoting the record's six would overstate the
   * evidence behind every window-scoped number in the brief.
   */
  windowCycles: Cycle[]
  aligned: Map<string, CycleDay>
  /** Day records within the window, indexed by date, sorted ascending. */
  daysByDate: Map<string, DayRecord>
  orderedDates: string[]
  calendarDays: number
  loggedDays: number
  /** loggedDays / calendarDays */
  coverage: number
  features: Map<string, SymptomFeatures>
  symptomIds: string[]
}

export function observationState(day: DayRecord | undefined, symptomId: string): TriState {
  if (!day || !day.logged) return 'unknown'
  return day.symptoms[symptomId]?.state ?? 'unknown'
}

export function observationSeverity(
  day: DayRecord | undefined,
  symptomId: string,
): number | undefined {
  if (!day || !day.logged) return undefined
  const obs = day.symptoms[symptomId]
  return obs?.state === 'present' ? obs.severity : undefined
}

/** Default analysis window: the last `days` calendar days ending at the last record. */
export function defaultWindow(record: PatientRecord, days = 92): AnalysisWindow {
  const sorted = [...record.days].sort((a, b) => a.date.localeCompare(b.date))
  const end = sorted[sorted.length - 1]?.date ?? new Date().toISOString().slice(0, 10)
  const start = sorted.length > 0 ? sorted[0].date : end
  const all = dateRange(start, end)
  const windowed = all.slice(Math.max(0, all.length - days))
  return { start: windowed[0] ?? end, end }
}

export function buildFeatureContext(
  record: PatientRecord,
  window?: AnalysisWindow,
  config: CycleConfig = DEFAULT_CYCLE_CONFIG,
): FeatureContext {
  const win = window ?? defaultWindow(record)
  const orderedDates = dateRange(win.start, win.end)
  const inWindow = new Set(orderedDates)

  const daysByDate = new Map<string, DayRecord>()
  for (const day of record.days) {
    if (inWindow.has(day.date)) daysByDate.set(day.date, day)
  }

  // Cycles are segmented from the full record, not just the window, so that a window
  // beginning mid-cycle still knows where that cycle actually started.
  const cycles = segmentCycles(record.days, config)
  const aligned = alignToCycles(orderedDates, cycles, config)
  const windowCycles = cycles.filter((c) => c.startDate >= win.start && c.startDate <= win.end)

  let loggedDays = 0
  for (const date of orderedDates) {
    if (daysByDate.get(date)?.logged) loggedDays++
  }

  const symptomIds = collectSymptomIds(record)
  const features = new Map<string, SymptomFeatures>()
  const ctx: FeatureContext = {
    record,
    window: win,
    config,
    cycles,
    windowCycles,
    aligned,
    daysByDate,
    orderedDates,
    calendarDays: orderedDates.length,
    loggedDays,
    coverage: orderedDates.length > 0 ? loggedDays / orderedDates.length : 0,
    features,
    symptomIds,
  }

  for (const id of symptomIds) {
    features.set(id, computeSymptomFeatures(ctx, id))
  }

  return ctx
}

/** Every symptom the patient tracks or has ever recorded an observation for. */
export function collectSymptomIds(record: PatientRecord): string[] {
  const ids = new Set<string>(record.trackedSymptomIds)
  for (const day of record.days) {
    for (const id of Object.keys(day.symptoms)) ids.add(id)
  }
  return [...ids].sort()
}

export function computeSymptomFeatures(
  ctx: FeatureContext,
  symptomId: string,
): SymptomFeatures {
  let observedDays = 0
  let daysPresent = 0
  let severeDays = 0
  let impactDays = 0
  let medicationDays = 0

  let mwObserved = 0
  let mwPresent = 0
  let nonMwObserved = 0
  let nonMwPresent = 0

  const severities: number[] = []
  let maxSeverity: number | null = null

  // Per-cycle tallies, keyed by cycle index.
  const cycleObserved = new Map<number, number>()
  const cyclePresent = new Map<number, number>()

  for (const date of ctx.orderedDates) {
    const day = ctx.daysByDate.get(date)
    const state = observationState(day, symptomId)
    if (state === 'unknown') continue // <- the rule this whole file exists to enforce

    observedDays++
    const present = state === 'present'
    if (present) daysPresent++

    const cycleDay = ctx.aligned.get(date)
    if (cycleDay) {
      cycleObserved.set(cycleDay.cycleIndex, (cycleObserved.get(cycleDay.cycleIndex) ?? 0) + 1)
      if (present) {
        cyclePresent.set(cycleDay.cycleIndex, (cyclePresent.get(cycleDay.cycleIndex) ?? 0) + 1)
      }

      if (cycleDay.inMenstrualWindow) {
        mwObserved++
        if (present) mwPresent++
      } else {
        nonMwObserved++
        if (present) nonMwPresent++
      }
    }

    if (present) {
      const sev = observationSeverity(day, symptomId)
      if (sev !== undefined) {
        severities.push(sev)
        if (maxSeverity === null || sev > maxSeverity) maxSeverity = sev
        if (sev >= SEVERE_THRESHOLD) severeDays++
      }
      if (day?.impact !== undefined && day.impact >= LIMITING_IMPACT) impactDays++
      if (day?.medications && day.medications.length > 0) medicationDays++
    }
  }

  // Per-cycle rates, oldest first. Only cycles with at least 5 observed days are
  // included — a cycle with 1 observed day produces a rate of 0 or 1 that would
  // dominate a trend test while carrying almost no information.
  const perCycleRates: number[] = []
  let cyclesWithSymptom = 0
  let cyclesObserved = 0
  for (const cycle of ctx.cycles) {
    const obs = cycleObserved.get(cycle.index) ?? 0
    if (obs < 5) continue
    cyclesObserved++
    const pres = cyclePresent.get(cycle.index) ?? 0
    if (pres > 0) cyclesWithSymptom++
    perCycleRates.push(pres / obs)
  }

  return {
    symptomId,
    observedDays,
    daysPresent,
    severeDays,
    medianSeverity: severities.length > 0 ? median(severities) : null,
    maxSeverity,
    menstrualWindowRate: mwObserved > 0 ? mwPresent / mwObserved : 0,
    menstrualWindowObserved: mwObserved,
    menstrualWindowPresent: mwPresent,
    nonMenstrualRate: nonMwObserved > 0 ? nonMwPresent / nonMwObserved : 0,
    nonMenstrualObserved: nonMwObserved,
    nonMenstrualPresent: nonMwPresent,
    cyclesWithSymptom,
    cyclesObserved,
    impactDays,
    medicationDays,
    coverage: ctx.calendarDays > 0 ? observedDays / ctx.calendarDays : 0,
    perCycleRates,
  }
}

// ---------------------------------------------------------------------------
// Supporting extractions used by the pattern detectors
// ---------------------------------------------------------------------------

/** Dates on which the symptom was recorded present. The evidence trail for a claim. */
export function presentDates(ctx: FeatureContext, symptomId: string): string[] {
  return ctx.orderedDates.filter(
    (d) => observationState(ctx.daysByDate.get(d), symptomId) === 'present',
  )
}

/**
 * Phase angles for the days a symptom was present.
 * Days in the trailing incomplete cycle have an undefined angle and are dropped —
 * we will not estimate a phase for a cycle whose length we have not yet observed.
 */
export function presentPhaseAngles(ctx: FeatureContext, symptomId: string): number[] {
  const angles: number[] = []
  for (const date of presentDates(ctx, symptomId)) {
    const angle = ctx.aligned.get(date)?.phaseAngle
    if (angle !== undefined && Number.isFinite(angle)) angles.push(angle)
  }
  return angles
}

/** Convert a mean phase angle back to a signed cycle-day, for human-readable output. */
export function angleToSignedCycleDay(angle: number, cycleLength: number): number {
  const forward = (angle / (2 * Math.PI)) * cycleLength
  return forward > cycleLength / 2 ? Math.round(forward - cycleLength) : Math.round(forward)
}

/** Binary present/absent vectors for two symptoms over days where BOTH were observed. */
export function pairedObservations(
  ctx: FeatureContext,
  symptomA: string,
  symptomB: string,
): { a: number[]; b: number[]; dates: string[] } {
  const a: number[] = []
  const b: number[] = []
  const dates: string[] = []
  for (const date of ctx.orderedDates) {
    const day = ctx.daysByDate.get(date)
    const sa = observationState(day, symptomA)
    const sb = observationState(day, symptomB)
    // Both must be known; a day where only one was asked tells us nothing about
    // co-occurrence and must not enter the contingency table.
    if (sa === 'unknown' || sb === 'unknown') continue
    a.push(sa === 'present' ? 1 : 0)
    b.push(sb === 'present' ? 1 : 0)
    dates.push(date)
  }
  return { a, b, dates }
}

export interface ImpactSummary {
  observedDays: number
  byLevel: Record<ImpactLevel, number>
  limitingDays: number
  couldNotPerformDays: number
  domainCounts: Record<string, number>
}

export function summariseImpact(ctx: FeatureContext): ImpactSummary {
  const byLevel: Record<ImpactLevel, number> = {
    [ImpactLevel.None]: 0,
    [ImpactLevel.Slight]: 0,
    [ImpactLevel.ModifiedActivities]: 0,
    [ImpactLevel.CouldNotPerform]: 0,
  }
  const domainCounts: Record<string, number> = {}
  let observedDays = 0

  for (const date of ctx.orderedDates) {
    const day = ctx.daysByDate.get(date)
    if (!day?.logged || day.impact === undefined) continue
    observedDays++
    byLevel[day.impact]++
    for (const domain of day.impactDomains ?? []) {
      domainCounts[domain] = (domainCounts[domain] ?? 0) + 1
    }
  }

  return {
    observedDays,
    byLevel,
    limitingDays:
      byLevel[ImpactLevel.ModifiedActivities] + byLevel[ImpactLevel.CouldNotPerform],
    couldNotPerformDays: byLevel[ImpactLevel.CouldNotPerform],
    domainCounts,
  }
}

export interface MedicationSummary {
  daysWithMedication: number
  byMedication: Record<string, number>
  /** Days a medication was taken AND a severe symptom was still recorded. */
  severeDespiteMedication: number
}

export function summariseMedication(ctx: FeatureContext): MedicationSummary {
  const byMedication: Record<string, number> = {}
  let daysWithMedication = 0
  let severeDespiteMedication = 0

  for (const date of ctx.orderedDates) {
    const day = ctx.daysByDate.get(date)
    if (!day?.logged || !day.medications || day.medications.length === 0) continue
    daysWithMedication++
    for (const med of day.medications) {
      byMedication[med.label] = (byMedication[med.label] ?? 0) + 1
    }
    const anySevere = Object.values(day.symptoms).some(
      (obs) => obs.state === 'present' && (obs.severity ?? 0) >= SEVERE_THRESHOLD,
    )
    if (anySevere) severeDespiteMedication++
  }

  return { daysWithMedication, byMedication, severeDespiteMedication }
}

export interface PhaseBin {
  signedCycleDay: number
  present: number
  observed: number
  rate: number
}

/**
 * Occurrence rate per signed cycle day, for the phase heatmap.
 *
 * Bins with zero observations are returned with observed = 0 rather than rate = 0, so
 * the UI can draw "never asked" differently from "asked and absent". Collapsing those
 * two into one colour is the visual form of the missing-data error.
 */
export function phaseProfile(
  ctx: FeatureContext,
  symptomId: string,
  from = -5,
  to = 8,
): PhaseBin[] {
  const bins = new Map<number, { present: number; observed: number }>()
  for (let d = from; d <= to; d++) bins.set(d, { present: 0, observed: 0 })

  for (const date of ctx.orderedDates) {
    const aligned = ctx.aligned.get(date)
    if (!aligned) continue
    const bin = bins.get(aligned.signedCycleDay)
    if (!bin) continue
    const state = observationState(ctx.daysByDate.get(date), symptomId)
    if (state === 'unknown') continue
    bin.observed++
    if (state === 'present') bin.present++
  }

  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([signedCycleDay, v]) => ({
      signedCycleDay,
      present: v.present,
      observed: v.observed,
      rate: v.observed > 0 ? v.present / v.observed : Number.NaN,
    }))
}

/** Daily total symptom burden, used for the timeline ribbon. Null on unlogged days. */
export function dailyBurden(ctx: FeatureContext): { date: string; burden: number | null }[] {
  return ctx.orderedDates.map((date) => {
    const day = ctx.daysByDate.get(date)
    if (!day?.logged) return { date, burden: null }
    let total = 0
    let counted = 0
    for (const obs of Object.values(day.symptoms)) {
      if (obs.state === 'unknown') continue
      counted++
      if (obs.state === 'present') total += obs.severity ?? 5
    }
    return { date, burden: counted > 0 ? total : null }
  })
}
