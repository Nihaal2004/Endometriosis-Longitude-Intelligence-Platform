/**
 * dayLog.ts — turning a filled-in check-in into a DayRecord.
 *
 * Pure, so the rules that protect the record can be tested directly. They exist
 * because the prototype's check-in broke three of them:
 *
 *   1. A symptom picked from "+ Add another" was never saved — save() only
 *      iterated the suggested chips.
 *   2. Editing a day rebuilt its symptoms from scratch, so anything recorded
 *      earlier but not suggested today would have been silently deleted.
 *   3. Extra chips were given a severity the patient never entered.
 *
 * The rules now:
 *
 *   - Start from what the day already holds. Nothing recorded is dropped.
 *   - A symptom the patient was ASKED about this session gets an answer: present
 *     if selected, absent if shown and left unselected. A suggested chip counts as
 *     asked. A symptom in the "+ Add another" list counts as asked only if tapped.
 *   - A symptom NOT asked keeps whatever it had — including staying unknown.
 *   - Severity is written only if the patient gave one now, or already had one
 *     for a symptom that is still present. It is never defaulted.
 */

import type { BleedingLevel, DayRecord, ImpactLevel, MedicationEntry, SymptomObservation } from '../../engine/types'

/** The primary pain question, always shown, answered on the 0–10 slider. */
export const PRIMARY_PAIN = 'pelvic_pain'

export interface DayLogDraft {
  bleeding: BleedingLevel
  /** 0 means "no pelvic pain" (asked, absent). */
  pain: number
  /** Symptoms the patient selected as present. */
  selected: Set<string>
  /** Symptoms shown as suggested chips. Shown and unselected = asked and absent. */
  shown: string[]
  /**
   * Symptoms from "+ Add another" that the patient tapped and then un-tapped.
   * They were asked, so they become absent; untouched list items stay unknown.
   */
  explicitlyCleared: Set<string>
  /** Optional tap-to-rate severities, only for symptoms the patient rated. */
  severities: Record<string, number>
  impact: ImpactLevel | null
  impactDomains: string[]
  medications: string[]
  note: string
  depth: DayRecord['depth']
}

/** Pre-fill a draft from an existing day, so editing starts exactly where the record is. */
export function draftFromDay(existing: DayRecord | undefined, shown: string[]): DayLogDraft {
  const selected = new Set<string>()
  const severities: Record<string, number> = {}
  for (const [id, obs] of Object.entries(existing?.symptoms ?? {})) {
    if (id === PRIMARY_PAIN) continue
    if (obs.state === 'present') {
      selected.add(id)
      if (typeof obs.severity === 'number') severities[id] = obs.severity
    }
  }
  const painObs = existing?.symptoms[PRIMARY_PAIN]
  return {
    bleeding: existing?.bleeding ?? 'none',
    pain: painObs?.state === 'present' ? (painObs.severity ?? 0) : 0,
    selected,
    shown,
    explicitlyCleared: new Set(),
    severities,
    impact: existing?.impact ?? null,
    impactDomains: existing?.impactDomains ?? [],
    medications: existing?.medications?.map((m) => m.label) ?? [],
    note: existing?.note ?? '',
    depth: existing?.depth ?? 'standard',
  }
}

export function buildDayRecord(date: string, draft: DayLogDraft, existing?: DayRecord): DayRecord {
  // 1. Start from everything already recorded for this day.
  const symptoms: Record<string, SymptomObservation> = { ...(existing?.symptoms ?? {}) }

  const answer = (id: string, present: boolean) => {
    if (!present) {
      symptoms[id] = { state: 'absent' }
      return
    }
    const rated = draft.severities[id]
    const previous = existing?.symptoms[id]
    const keptSeverity =
      previous?.state === 'present' && typeof previous.severity === 'number'
        ? previous.severity
        : undefined
    const severity = typeof rated === 'number' ? rated : keptSeverity
    symptoms[id] = severity === undefined ? { state: 'present' } : { state: 'present', severity }
  }

  // 2. The primary pain question is always asked.
  symptoms[PRIMARY_PAIN] =
    draft.pain > 0 ? { state: 'present', severity: draft.pain } : { state: 'absent' }

  // 3. Suggested chips were shown, so each one was asked.
  for (const id of draft.shown) {
    if (id === PRIMARY_PAIN) continue
    answer(id, draft.selected.has(id))
  }

  // 4. Anything selected from "+ Add another" was asked and is present.
  for (const id of draft.selected) {
    if (id === PRIMARY_PAIN || draft.shown.includes(id)) continue
    answer(id, true)
  }

  // 5. Tapped-then-untapped from "+ Add another": asked, and the answer is no.
  for (const id of draft.explicitlyCleared) {
    if (!draft.selected.has(id) && !draft.shown.includes(id)) answer(id, false)
  }

  const medications: MedicationEntry[] = draft.medications.map((label) => {
    const previous = existing?.medications?.find((m) => m.label === label)
    return previous ?? { medicationId: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label }
  })

  return {
    date,
    logged: true,
    bleeding: draft.bleeding,
    // An unanswered impact question stays unknown rather than becoming "no interference".
    impact: draft.impact ?? undefined,
    impactDomains:
      draft.impact !== null && draft.impact >= 2 && draft.impactDomains.length > 0
        ? draft.impactDomains
        : undefined,
    symptoms,
    medications: medications.length > 0 ? medications : undefined,
    note: draft.note.trim() || undefined,
    depth: draft.depth,
  }
}
