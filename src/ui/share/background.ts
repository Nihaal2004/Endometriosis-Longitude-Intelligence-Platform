/**
 * background.ts — the baseline profile as short report lines.
 *
 * One source for the report screen, a share link and the PDF, so all three
 * word the same answers the same way. Only answered questions produce a line:
 * an unanswered one is left out, never shown as "no". Fertility and pregnancy
 * lines are a separate group so a share link can leave them out.
 */

import { formatDateLong } from '../../engine/brief'
import type { CurrentPastNever, HealthBackground, PatientProfile, YesNoUnsure } from '../../engine/types'

export type BackgroundGroup = 'history' | 'menstrual' | 'fertility'

export interface BackgroundLine {
  group: BackgroundGroup
  label: string
  value: string
}

export const BACKGROUND_GROUP_TITLES: Record<BackgroundGroup, string> = {
  history: 'Medical history',
  menstrual: 'Menstrual history',
  fertility: 'Fertility and pregnancy',
}

const YES_NO: Record<YesNoUnsure, string> = { yes: 'Yes', no: 'No', unsure: 'Unsure' }
const CURRENT_PAST: Record<CurrentPastNever, string> = { current: 'Currently', past: 'In the past', never: 'Never' }
const REGULARITY = { regular: 'Regular', variable: 'Somewhat variable', highly_irregular: 'Highly irregular' } as const
const PREGNANCY_HISTORY: Record<NonNullable<HealthBackground['pregnancyHistory']>, string> = {
  never: 'Never pregnant',
  previous: 'Has been pregnant',
  prefer_not: 'Prefers not to say',
}
const GOALS: Record<NonNullable<HealthBackground['reproductiveGoals']>, string> = {
  trying: 'Trying to conceive',
  later: 'Planning pregnancy later',
  not_planning: 'Not planning pregnancy',
  unsure: 'Unsure',
}

export function backgroundLines(profile: PatientProfile, opts: { fertility: boolean }): BackgroundLine[] {
  const b = profile.background ?? {}
  const lines: BackgroundLine[] = []
  const add = (group: BackgroundGroup, label: string, value: string | undefined) => {
    if (value) lines.push({ group, label, value })
  }
  const yesNo = (v: boolean | undefined) => (v === undefined ? undefined : v ? 'Yes' : 'No')

  add('history', 'Symptoms since', profile.symptomOnsetYear ? String(profile.symptomOnsetYear) : undefined)
  add('history', 'Family history of endometriosis', yesNo(profile.familyHistory))
  add('history', 'Previous pelvic surgery', yesNo(profile.previousPelvicSurgery))
  add('history', 'Other health conditions', b.healthConditions?.join('; '))

  add('menstrual', 'First period at age', profile.ageAtMenarche ? String(profile.ageAtMenarche) : undefined)
  add('menstrual', 'Usual cycle length', profile.usualCycleLength
    ? profile.usualCycleLength[0] === profile.usualCycleLength[1]
      ? `${profile.usualCycleLength[0]} days`
      : `${profile.usualCycleLength[0]}–${profile.usualCycleLength[1]} days`
    : undefined)
  add('menstrual', 'Cycle regularity', profile.cycleRegularity ? REGULARITY[profile.cycleRegularity] : undefined)
  add('menstrual', 'Bleeding usually lasts', b.typicalBleedingDays
    ? `${b.typicalBleedingDays} day${b.typicalBleedingDays === 1 ? '' : 's'}`
    : undefined)
  add('menstrual', 'Heavy periods', b.heavyBleeding && YES_NO[b.heavyBleeding])
  add('menstrual', 'Spotting between periods', b.spottingBetweenPeriods && YES_NO[b.spottingBetweenPeriods])
  add('menstrual', 'Last period started', b.lastPeriodStart && formatDateLong(b.lastPeriodStart))
  add('menstrual', 'Hormonal contraception', b.hormonalContraception && CURRENT_PAST[b.hormonalContraception])
  add('menstrual', 'No periods because of treatment', yesNo(b.treatmentAmenorrhoea))

  if (opts.fertility) {
    add('fertility', 'Pregnancy history', b.pregnancyHistory && PREGNANCY_HISTORY[b.pregnancyHistory])
    add('fertility', 'Could be pregnant now', b.pregnancyPossible && YES_NO[b.pregnancyPossible])
    add('fertility', 'Fertility concerns', b.fertilityConcerns && YES_NO[b.fertilityConcerns])
    add('fertility', 'Plans for pregnancy', b.reproductiveGoals && GOALS[b.reproductiveGoals])
    add('fertility', 'Fertility treatment', b.fertilityTreatment && CURRENT_PAST[b.fertilityTreatment])
  }
  return lines
}

/** True if the profile holds any fertility or pregnancy answer. */
export function hasFertilityAnswers(profile: PatientProfile): boolean {
  return backgroundLines(profile, { fertility: true }).some((l) => l.group === 'fertility')
}
