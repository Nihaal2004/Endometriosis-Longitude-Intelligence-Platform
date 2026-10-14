/**
 * cycles.ts — Cycle segmentation and phase alignment.
 *
 * The defining constraint of this module: **no cycle is ever predicted or assumed.**
 * Consumer trackers forecast the next period, which pushes them toward smoothing and
 * imputing a canonical ~28-day cycle. Our objective is retrospective pattern
 * description, so cycles are segmented purely from recorded bleeding, each cycle keeps
 * its own observed length, and the trailing cycle — whose end has not happened yet —
 * is explicitly marked incomplete and excluded from anything that needs a length.
 */

import {
  BLEEDING_FLOW_LEVELS,
  type BleedingLevel,
  type Cycle,
  type CycleDay,
  type DayRecord,
} from './types'

// ---------------------------------------------------------------------------
// Date helpers — all arithmetic in UTC so results never shift with local timezone
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86400000

export function parseDate(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function formatDate(ms: number): string {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(iso: string, days: number): string {
  return formatDate(parseDate(iso) + days * MS_PER_DAY)
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseDate(toIso) - parseDate(fromIso)) / MS_PER_DAY)
}

/** Every calendar date from `start` to `end`, inclusive. */
export function dateRange(startIso: string, endIso: string): string[] {
  const out: string[] = []
  const n = daysBetween(startIso, endIso)
  for (let i = 0; i <= n; i++) out.push(addDays(startIso, i))
  return out
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CycleConfig {
  /**
   * Minimum days between two menstrual onsets. A flow run starting sooner than this
   * after the previous onset is treated as continued or breakthrough bleeding, not a
   * new period. 10 days is deliberately permissive — endometriosis populations have
   * genuinely short and irregular cycles, and we would rather merge than invent a
   * cycle boundary that did not happen.
   */
  minCycleGapDays: number
  /** Days before menstrual onset included in the menstrual window. */
  windowBefore: number
  /** Days from onset (D0 counts as day 0) included in the menstrual window. */
  windowAfter: number
  /** Cycles longer than this are flagged as probably spanning an unlogged period. */
  maxPlausibleCycleDays: number
  /**
   * The longest stretch, in days, between two logged flow days that still counts as
   * one continuous bleeding run when the days between are unlogged. Bridging a
   * day or two of missing entries mid-period is right; bridging weeks is not — two
   * flow days 27 days apart with nothing logged between are two periods.
   */
  maxRunGapDays: number
}

export const DEFAULT_CYCLE_CONFIG: CycleConfig = {
  minCycleGapDays: 10,
  // 3 = up to two unlogged days inside a period. Bleeding runs are rarely longer than
  // nine days, so anything beyond this is better read as a new run; the 10-day
  // minimum above still stops a short gap from inventing a new cycle.
  maxRunGapDays: 3,
  // D-2 .. D+3, a 6-day window. Chosen to match the perimenstrual window used in the
  // endometriosis pain literature (symptoms characteristically begin 1-2 days before
  // onset and persist through early flow), and fixed in advance rather than tuned per
  // patient, so the menstrual-window rate means the same thing in every brief.
  windowBefore: 2,
  windowAfter: 3,
  maxPlausibleCycleDays: 60,
}

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

function isFlow(level: BleedingLevel | undefined): boolean {
  return level !== undefined && BLEEDING_FLOW_LEVELS.includes(level)
}

/**
 * Segment a day series into cycles.
 *
 * A cycle opens on the first day of a menstrual flow run that begins at least
 * `minCycleGapDays` after the previous onset. Spotting never opens a cycle — it is
 * recorded but is not menstruation, and treating it as onset is a common source of
 * spurious short cycles in consumer trackers.
 */
export function segmentCycles(
  days: DayRecord[],
  config: CycleConfig = DEFAULT_CYCLE_CONFIG,
): Cycle[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const onsets: string[] = []

  let previousWasFlow = false
  let lastLoggedDate: string | null = null
  for (const day of sorted) {
    if (!day.logged) continue
    const flow = isFlow(day.bleeding)
    // A flow day continues the current run only if the previous LOGGED day was
    // also flow and close enough. A day or two of missing entries inside a period
    // does not break it — we do not know what happened, so we do not manufacture a
    // gap — but a long silence does, or sparse loggers would have every period
    // after the first absorbed into one endless run.
    const continuesRun =
      previousWasFlow &&
      lastLoggedDate !== null &&
      daysBetween(lastLoggedDate, day.date) <= config.maxRunGapDays
    if (flow && !continuesRun) {
      const last = onsets[onsets.length - 1]
      if (!last || daysBetween(last, day.date) >= config.minCycleGapDays) {
        onsets.push(day.date)
      }
    }
    previousWasFlow = flow
    lastLoggedDate = day.date
  }

  if (onsets.length === 0) return []

  const lastDate = sorted[sorted.length - 1]?.date ?? onsets[onsets.length - 1]

  return onsets.map((startDate, i) => {
    const nextStart = onsets[i + 1]
    const complete = nextStart !== undefined
    const endDate = complete ? addDays(nextStart, -1) : lastDate
    const lengthDays = daysBetween(startDate, endDate) + 1

    let bleedDays = 0
    for (const day of sorted) {
      if (day.date >= startDate && day.date <= endDate && isFlow(day.bleeding)) {
        bleedDays++
      }
    }

    return { index: i, startDate, endDate, lengthDays, bleedDays, complete }
  })
}

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

/**
 * Position each date within its cycle.
 *
 * Produces three coordinates per day:
 *
 *   dayInCycle     — days elapsed since this cycle's onset (0-based, D0 = onset).
 *   signedCycleDay — the same day expressed relative to the *nearest* onset, so the
 *                    late luteal phase reads as D-2, D-1 rather than D26, D27. This
 *                    is the coordinate clinicians actually reason in. It requires
 *                    knowing the cycle length, so for the trailing incomplete cycle we
 *                    fall back to the forward count rather than guess.
 *   phaseAngle     — the day's proportional position around its own cycle, in radians.
 *                    Because it is normalised by *that cycle's* observed length, a
 *                    24-day and a 34-day cycle are comparable without assuming 28.
 */
export function alignToCycles(
  dates: string[],
  cycles: Cycle[],
  config: CycleConfig = DEFAULT_CYCLE_CONFIG,
): Map<string, CycleDay> {
  const out = new Map<string, CycleDay>()
  if (cycles.length === 0) return out

  for (const date of dates) {
    const cycle = cycles.find((c) => date >= c.startDate && date <= c.endDate)
    if (!cycle) continue // days before the first recorded onset have no phase

    const dayInCycle = daysBetween(cycle.startDate, date)
    const cycleLength = cycle.lengthDays

    let signedCycleDay: number
    if (cycle.complete && dayInCycle > cycleLength / 2) {
      // Closer to the next onset than to this one.
      signedCycleDay = dayInCycle - cycleLength
    } else {
      signedCycleDay = dayInCycle
    }

    const phaseAngle = cycle.complete
      ? (2 * Math.PI * dayInCycle) / cycleLength
      : Number.NaN // undefined until the cycle closes; excluded from circular tests

    const inMenstrualWindow =
      signedCycleDay >= -config.windowBefore && signedCycleDay <= config.windowAfter

    out.set(date, {
      date,
      cycleIndex: cycle.index,
      dayInCycle,
      signedCycleDay,
      phaseAngle,
      cycleLength,
      inMenstrualWindow,
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// Descriptive cycle summary
// ---------------------------------------------------------------------------

export interface CycleSummary {
  count: number
  completeCount: number
  medianLength: number | null
  minLength: number | null
  maxLength: number | null
  medianBleedDays: number | null
  /** Max - min across complete cycles; a simple irregularity read-out. */
  lengthRange: number | null
  regularity: 'regular' | 'variable' | 'highly_irregular' | 'unknown'
}

export function summariseCycles(cycles: Cycle[]): CycleSummary {
  const complete = cycles.filter((c) => c.complete)
  if (complete.length === 0) {
    return {
      count: cycles.length,
      completeCount: 0,
      medianLength: null,
      minLength: null,
      maxLength: null,
      medianBleedDays: null,
      lengthRange: null,
      regularity: 'unknown',
    }
  }

  const lengths = complete.map((c) => c.lengthDays).sort((a, b) => a - b)
  const bleedDays = complete.map((c) => c.bleedDays).sort((a, b) => a - b)
  const mid = (arr: number[]) =>
    arr.length % 2 ? arr[arr.length >> 1] : (arr[(arr.length >> 1) - 1] + arr[arr.length >> 1]) / 2

  const range = lengths[lengths.length - 1] - lengths[0]

  // Thresholds follow the conventional clinical description of cycle regularity
  // (variation within ~7 days across a year is considered regular).
  let regularity: CycleSummary['regularity'] = 'unknown'
  if (complete.length >= 2) {
    if (range <= 7) regularity = 'regular'
    else if (range <= 14) regularity = 'variable'
    else regularity = 'highly_irregular'
  }

  return {
    count: cycles.length,
    completeCount: complete.length,
    medianLength: mid(lengths),
    minLength: lengths[0],
    maxLength: lengths[lengths.length - 1],
    medianBleedDays: mid(bleedDays),
    lengthRange: range,
    regularity,
  }
}
