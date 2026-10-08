/**
 * adaptive.ts — Deciding what to ask today.
 *
 * The product thesis in one file: the underlying data model has well over a hundred
 * fields, and the patient should see four or five of them. Retention in symptom
 * tracking fails to logging fatigue, so the most valuable form of personalisation is
 * not recommending content — it is *question reduction*.
 *
 * Three forces decide what appears:
 *
 *   1. FREQUENCY. Symptoms this patient actually reports become shortcuts.
 *   2. DORMANCY. A symptom never reported present in many observed days stops being
 *      asked daily and retreats behind "add another symptom".
 *   3. CYCLE PHASE. A symptom with an established perimenstrual pattern is surfaced
 *      during that window and de-prioritised outside it.
 *
 * Two safeguards keep this from quietly damaging the data:
 *
 *   - Nothing is ever removed from the vocabulary. Every symptom remains reachable at
 *     all times, so the interface controls priority, not what the patient is permitted
 *     to report.
 *   - A symptom that is not asked is recorded as `unknown`, never as `absent`. Question
 *     reduction therefore reduces burden without manufacturing negative observations —
 *     which is exactly the failure mode that makes consumer tracker data unusable.
 */

import type { CycleDay } from './types'
import type { FeatureContext } from './features'
import { getSymptom } from './symptoms'

export interface AdaptiveConfig {
  /** Symptom chips shown on the daily check-in before "more". */
  maxChips: number
  /** Observed days a symptom can go without being reported present before it sleeps. */
  dormancyDays: number
  /** Minimum observed days before dormancy can apply at all. */
  minObservationsBeforeDormancy: number
  /** Menstrual-window rate ratio above which a symptom is treated as phase-linked. */
  cyclicalRatio: number
}

export const DEFAULT_ADAPTIVE: AdaptiveConfig = {
  maxChips: 4,
  // 45 observed days is roughly one and a half cycles. Shorter than this and a symptom
  // that is genuinely cyclical but happened to be quiet for one cycle would be put to
  // sleep just before the cycle in which it returns.
  dormancyDays: 45,
  minObservationsBeforeDormancy: 30,
  cyclicalRatio: 1.5,
}

export type SurfaceReason =
  | 'core'
  | 'frequent'
  | 'cycle_phase'
  | 'recent'
  | 'user_pinned'

export interface SurfacedQuestion {
  symptomId: string
  reason: SurfaceReason
  /** Higher sorts first. */
  score: number
}

export interface DormantSymptom {
  symptomId: string
  observedDays: number
  lastPresent: string | null
}

export interface AdaptivePlan {
  /** Symptom chips to show today, in order. */
  surfaced: SurfacedQuestion[]
  /** Symptoms deliberately not asked today, with the reason. Shown as "why not?". */
  dormant: DormantSymptom[]
  /** Fields the patient is actually presented with today. */
  fieldCount: number
  /** Fields a fixed questionnaire covering the same vocabulary would present. */
  staticFieldCount: number
  cycleDay: CycleDay | null
}

/**
 * Fields present on every check-in regardless of personalisation: bleeding, the
 * primary pain scale, and the functional-impact question. Impact is non-negotiable —
 * it is the field the outcome literature is most consistent about and the one a
 * clinician can least reconstruct from memory.
 */
const CORE_FIELDS = 3

export function planDailyQuestions(
  ctx: FeatureContext,
  date: string,
  pinned: string[] = [],
  config: AdaptiveConfig = DEFAULT_ADAPTIVE,
): AdaptivePlan {
  const cycleDay = ctx.aligned.get(date) ?? null
  const surfaced: SurfacedQuestion[] = []
  const dormant: DormantSymptom[] = []

  for (const symptomId of ctx.symptomIds) {
    const f = ctx.features.get(symptomId)
    if (!f) continue

    const def = getSymptom(symptomId) ?? ctx.record.customSymptoms?.find(s => s.id === symptomId)
    // Sensitive modules are opt-in and never surfaced automatically.
    if (def?.sensitive && !pinned.includes(symptomId)) continue

    if (pinned.includes(symptomId)) {
      surfaced.push({ symptomId, reason: 'user_pinned', score: 1000 })
      continue
    }

    // --- Dormancy ---
    const lastPresent = lastPresentDate(ctx, symptomId, date)
    const observedSince = lastPresent === null ? f.observedDays : observedDaysSince(ctx, lastPresent, date)

    if (
      f.observedDays >= config.minObservationsBeforeDormancy &&
      observedSince > config.dormancyDays
    ) {
      dormant.push({ symptomId, observedDays: f.observedDays, lastPresent })
      continue
    }

    // --- Scoring ---
    // Base score is how often this patient reports it.
    let score = f.observedDays > 0 ? (f.daysPresent / f.observedDays) * 100 : 0
    let reason: SurfaceReason = 'frequent'

    // Phase-linked symptoms get a large boost inside their window and a penalty
    // outside it. This is a UX priority decision, not a medical one: the symptom is
    // still reportable on any day.
    const phaseLinked =
      f.nonMenstrualRate > 0 && f.menstrualWindowRate / f.nonMenstrualRate >= config.cyclicalRatio
    if (phaseLinked && cycleDay) {
      if (cycleDay.inMenstrualWindow) {
        score += 60
        reason = 'cycle_phase'
      } else {
        score -= 25
      }
    }

    // Recency: something reported in the last week stays visible.
    if (lastPresent && observedDaysSince(ctx, lastPresent, date) <= 7) {
      score += 20
      if (reason === 'frequent') reason = 'recent'
    }

    surfaced.push({ symptomId, reason, score })
  }

  surfaced.sort((a, b) => b.score - a.score)
  const shown = surfaced.slice(0, config.maxChips)

  return {
    surfaced: shown,
    dormant,
    fieldCount: CORE_FIELDS + shown.length,
    // The comparator: a fixed questionnaire would present every non-sensitive symptom
    // in the patient's vocabulary, every day, forever.
    staticFieldCount:
      CORE_FIELDS + ctx.symptomIds.filter((id) => !getSymptom(id)?.sensitive).length,
    cycleDay,
  }
}

function lastPresentDate(ctx: FeatureContext, symptomId: string, before: string): string | null {
  for (let i = ctx.orderedDates.length - 1; i >= 0; i--) {
    const date = ctx.orderedDates[i]
    if (date >= before) continue
    const day = ctx.daysByDate.get(date)
    if (day?.logged && day.symptoms[symptomId]?.state === 'present') return date
  }
  return null
}

function observedDaysSince(ctx: FeatureContext, from: string, to: string): number {
  let n = 0
  for (const date of ctx.orderedDates) {
    if (date <= from || date >= to) continue
    if (ctx.daysByDate.get(date)?.logged) n++
  }
  return n
}

/**
 * Human-readable explanation of why a symptom is not being asked about today.
 * Surfaced in the UI so question reduction is visible rather than mysterious —
 * a patient who cannot see why a question disappeared has no reason to trust that it
 * would come back.
 */
export function explainDormancy(d: DormantSymptom): string {
  const label = getSymptom(d.symptomId)?.label ?? d.symptomId
  if (d.lastPresent === null) {
    return `${label} hasn't been reported in ${d.observedDays} days of entries, so it's moved out of the daily list. Tap "Add another" any time.`
  }
  return `${label} was last reported on ${d.lastPresent}, so it's moved out of the daily list. Tap "Add another" any time.`
}
