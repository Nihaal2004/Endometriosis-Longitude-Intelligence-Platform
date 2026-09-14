/**
 * baseline.ts — Change from the patient's own previous pattern.
 *
 * The comparison that matters clinically, especially before diagnosis, is *this
 * patient versus herself*, not this patient versus a population average. Population
 * comparison would require a reference distribution we do not have and would invite
 * exactly the kind of normative scoring this system refuses to produce.
 *
 * So: take the most recent complete cycle, compare its occurrence rate against the
 * pooled rate of the preceding cycles, and test the difference with an exact Poisson
 * rate comparison. Counts here are genuinely small — a cycle might contribute 3 events
 * over 22 observed days — which is precisely where the exact conditional test earns
 * its place over a normal approximation.
 */

import { observationState, type FeatureContext } from './features'
import { poissonRateTest, wilsonInterval } from './stats'
import type { Finding } from './types'

export interface CycleTally {
  cycleIndex: number
  startDate: string
  observed: number
  present: number
  rate: number
}

/** Per-cycle observed/present counts for one symptom, oldest cycle first. */
export function tallyByCycle(ctx: FeatureContext, symptomId: string): CycleTally[] {
  const tallies = new Map<number, { observed: number; present: number }>()

  for (const date of ctx.orderedDates) {
    const cycleDay = ctx.aligned.get(date)
    if (!cycleDay) continue
    const state = observationState(ctx.daysByDate.get(date), symptomId)
    if (state === 'unknown') continue

    const entry = tallies.get(cycleDay.cycleIndex) ?? { observed: 0, present: 0 }
    entry.observed++
    if (state === 'present') entry.present++
    tallies.set(cycleDay.cycleIndex, entry)
  }

  return ctx.cycles
    .map((cycle) => {
      const t = tallies.get(cycle.index)
      if (!t) return null
      return {
        cycleIndex: cycle.index,
        startDate: cycle.startDate,
        observed: t.observed,
        present: t.present,
        rate: t.observed > 0 ? t.present / t.observed : 0,
      }
    })
    .filter((t): t is CycleTally => t !== null)
    .sort((a, b) => a.cycleIndex - b.cycleIndex)
}

/**
 * Compare the latest cycle against the patient's prior cycles.
 *
 * `restrictToNonMenstrual` exists because the most clinically telling version of this
 * question is usually about non-menstrual days: pain during a period is expected, and
 * an increase in pain *outside* menstruation is the change worth surfacing.
 */
export function detectBaselineChange(
  ctx: FeatureContext,
  symptomId: string,
  restrictToNonMenstrual = true,
): Finding | null {
  let latestPresent = 0
  let latestObserved = 0
  let priorPresent = 0
  let priorObserved = 0
  const latestDates: string[] = []

  const completeCycles = ctx.cycles.filter((c) => c.complete)
  if (completeCycles.length < 2) return null

  // The reference cycle is the most recent *complete* one; the trailing partial cycle
  // is excluded because a half-observed cycle would understate its own count.
  const latestIndex = completeCycles[completeCycles.length - 1].index

  for (const date of ctx.orderedDates) {
    const cycleDay = ctx.aligned.get(date)
    if (!cycleDay) continue
    if (restrictToNonMenstrual && cycleDay.inMenstrualWindow) continue
    if (cycleDay.cycleIndex > latestIndex) continue // drop the trailing partial cycle

    const state = observationState(ctx.daysByDate.get(date), symptomId)
    if (state === 'unknown') continue

    const isLatest = cycleDay.cycleIndex === latestIndex
    if (isLatest) {
      latestObserved++
      if (state === 'present') {
        latestPresent++
        latestDates.push(date)
      }
    } else {
      priorObserved++
      if (state === 'present') priorPresent++
    }
  }

  if (latestObserved === 0 || priorObserved === 0) return null

  const test = poissonRateTest(latestPresent, latestObserved, priorPresent, priorObserved)
  const latestCi = wilsonInterval(latestPresent, latestObserved)
  const priorCi = wilsonInterval(priorPresent, priorObserved)

  return {
    id: `baseline_change:${symptomId}${restrictToNonMenstrual ? ':non_menstrual' : ''}`,
    kind: 'baseline_change',
    symptomId,
    values: {
      latestPresent,
      latestObserved,
      latestRate: latestPresent / latestObserved,
      latestRateLow: latestCi.low,
      latestRateHigh: latestCi.high,
      priorPresent,
      priorObserved,
      priorRate: priorPresent / priorObserved,
      priorRateLow: priorCi.low,
      priorRateHigh: priorCi.high,
      rateRatio: Number.isFinite(test.rateRatio) ? test.rateRatio : 0,
      priorCycles: completeCycles.length - 1,
      restrictedToNonMenstrual: restrictToNonMenstrual ? 1 : 0,
    },
    test: { name: 'Exact Poisson rate comparison', statistic: test.rateRatio, p: test.p },
    effect: {
      label: 'Rate ratio (latest cycle vs previous cycles)',
      value: Number.isFinite(test.rateRatio) ? test.rateRatio : 0,
      unit: 'x',
    },
    coverage: ctx.features.get(symptomId)?.coverage ?? ctx.coverage,
    observedDays: latestObserved + priorObserved,
    evidenceDates: latestDates,
    passed: false,
  }
}

/** Run the baseline-change detector for every symptom with enough data to support it. */
export function detectAllBaselineChanges(ctx: FeatureContext, minEvents = 3): Finding[] {
  const out: Finding[] = []
  for (const symptomId of ctx.symptomIds) {
    const f = ctx.features.get(symptomId)
    if (!f || f.daysPresent < minEvents) continue
    const finding = detectBaselineChange(ctx, symptomId, true)
    if (finding) out.push(finding)
  }
  return out
}
