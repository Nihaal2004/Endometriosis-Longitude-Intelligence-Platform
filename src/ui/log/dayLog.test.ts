import { describe, expect, it } from 'vitest'
import { buildDayRecord, draftFromDay, type DayLogDraft } from './dayLog'
import { ImpactLevel, type DayRecord } from '../../engine/types'

function draft(patch: Partial<DayLogDraft> = {}): DayLogDraft {
  return {
    bleeding: 'none',
    pain: 0,
    selected: new Set(),
    shown: ['fatigue', 'bloating'],
    explicitlyCleared: new Set(),
    severities: {},
    impact: null,
    impactDomains: [],
    medications: [],
    note: '',
    depth: 'standard',
    ...patch,
  }
}

describe('saving a check-in', () => {
  it('saves a symptom chosen from "+ Add another" (the prototype dropped it)', () => {
    const day = buildDayRecord('2026-10-15', draft({ selected: new Set(['painful_bm']) }))
    expect(day.symptoms.painful_bm).toEqual({ state: 'present' })
  })

  it('records suggested-but-unselected chips as absent, since they were asked', () => {
    const day = buildDayRecord('2026-10-15', draft({ selected: new Set(['fatigue']) }))
    expect(day.symptoms.fatigue).toEqual({ state: 'present' })
    expect(day.symptoms.bloating).toEqual({ state: 'absent' })
  })

  it('leaves symptoms nobody asked about unknown — absent from the record', () => {
    const day = buildDayRecord('2026-10-15', draft())
    expect('nausea' in day.symptoms).toBe(false)
    expect('painful_bm' in day.symptoms).toBe(false)
  })

  it('never writes a severity the patient did not enter (the prototype invented one)', () => {
    const day = buildDayRecord('2026-10-15', draft({ pain: 8, selected: new Set(['fatigue', 'painful_bm']) }))
    expect(day.symptoms.fatigue).toEqual({ state: 'present' })
    expect(day.symptoms.painful_bm).toEqual({ state: 'present' })
    expect(day.symptoms.pelvic_pain).toEqual({ state: 'present', severity: 8 })
  })

  it('records a tap-to-rate severity when one is given', () => {
    const day = buildDayRecord(
      '2026-10-15',
      draft({ selected: new Set(['fatigue']), severities: { fatigue: 6 } }),
    )
    expect(day.symptoms.fatigue).toEqual({ state: 'present', severity: 6 })
  })

  it('treats pain 0 as asked-and-absent', () => {
    expect(buildDayRecord('2026-10-15', draft()).symptoms.pelvic_pain).toEqual({ state: 'absent' })
  })

  it('keeps an unanswered impact question unknown rather than "no interference"', () => {
    expect(buildDayRecord('2026-10-15', draft()).impact).toBeUndefined()
    expect(buildDayRecord('2026-10-15', draft({ impact: ImpactLevel.None })).impact).toBe(0)
  })
})

describe('editing a past day', () => {
  const existing: DayRecord = {
    date: '2026-10-10',
    logged: true,
    bleeding: 'heavy',
    impact: ImpactLevel.CouldNotPerform,
    impactDomains: ['work'],
    symptoms: {
      pelvic_pain: { state: 'present', severity: 7 },
      painful_bm: { state: 'present', severity: 6 }, // recorded then; not suggested today
      dysuria: { state: 'absent' },
      custom_left_leg_pain: { state: 'present' },
    },
    medications: [{ medicationId: 'ibuprofen', label: 'Ibuprofen', dose: '400 mg' }],
  }

  it('pre-fills the form exactly as the day was stored', () => {
    const d = draftFromDay(existing, ['fatigue'])
    expect(d.bleeding).toBe('heavy')
    expect(d.pain).toBe(7)
    expect(d.impact).toBe(ImpactLevel.CouldNotPerform)
    expect([...d.selected].sort()).toEqual(['custom_left_leg_pain', 'painful_bm'])
    expect(d.medications).toEqual(['Ibuprofen'])
  })

  it('preserves every symptom recorded that day, even ones not shown now', () => {
    const d = draftFromDay(existing, ['fatigue'])
    const saved = buildDayRecord('2026-10-10', { ...d, bleeding: 'moderate' }, existing)
    expect(saved.symptoms.painful_bm).toEqual({ state: 'present', severity: 6 })
    expect(saved.symptoms.dysuria).toEqual({ state: 'absent' })
    expect(saved.symptoms.custom_left_leg_pain).toEqual({ state: 'present' })
    expect(saved.bleeding).toBe('moderate')
  })

  it('a no-change edit reproduces the stored day', () => {
    const d = draftFromDay(existing, [])
    const saved = buildDayRecord('2026-10-10', d, existing)
    expect(saved.symptoms).toEqual(existing.symptoms)
    expect(saved.medications).toEqual(existing.medications) // dose kept
    expect(saved.impactDomains).toEqual(['work'])
  })

  it('un-ticking a previously present symptom makes it absent, not unknown', () => {
    const d = draftFromDay(existing, [])
    d.selected.delete('painful_bm')
    d.explicitlyCleared.add('painful_bm')
    const saved = buildDayRecord('2026-10-10', d, existing)
    expect(saved.symptoms.painful_bm).toEqual({ state: 'absent' })
  })

  it('keeps a stored severity when the symptom is still present and not re-rated', () => {
    const d = draftFromDay(existing, ['painful_bm'])
    d.severities = {} // the patient did not re-rate it
    const saved = buildDayRecord('2026-10-10', d, existing)
    expect(saved.symptoms.painful_bm).toEqual({ state: 'present', severity: 6 })
  })
})
