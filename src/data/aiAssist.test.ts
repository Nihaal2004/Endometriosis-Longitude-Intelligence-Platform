import { describe, expect, it } from 'vitest'
import { acceptRewrites, validateDayInterpretation } from './aiAssist'
import type { Claim } from '../engine/types'

const catalog = [
  { id: 'fatigue', label: 'Fatigue' },
  { id: 'diarrhoea', label: 'Diarrhoea' },
]
const areas = ['work', 'education', 'sleep']

describe('reading a day from her note', () => {
  it('keeps answers from the fixed choices only', () => {
    const r = validateDayInterpretation({
      bleeding: 'heavy', pain: 8, symptomIds: ['diarrhoea', 'not_on_list'], unmatched: ['jaw ache'],
      impact: 3, areas: ['education', 'flying'], medications: ['Ibuprofen', '<script>'],
    }, catalog, areas)
    expect(r).toEqual({
      bleeding: 'heavy', pain: 8, symptomIds: ['diarrhoea'], unmatched: ['jaw ache'],
      impact: 3, areas: ['education'], medications: ['Ibuprofen'],
    })
  })

  it('leaves anything unstated as unknown, never as none or zero', () => {
    const r = validateDayInterpretation({ bleeding: 'purple', pain: 14, symptomIds: ['fatigue'], impact: 9 }, catalog, areas)
    expect(r?.bleeding).toBeNull()
    expect(r?.pain).toBeNull()
    expect(r?.impact).toBeNull()
    expect(r?.symptomIds).toEqual(['fatigue'])
  })

  it('drops affected areas unless symptoms changed plans or stopped something', () => {
    const r = validateDayInterpretation({ impact: 1, areas: ['work'] }, catalog, areas)
    expect(r?.areas).toEqual([])
  })

  it('returns nothing when the note gave nothing usable', () => {
    expect(validateDayInterpretation({}, catalog, areas)).toBeNull()
    expect(validateDayInterpretation('nonsense', catalog, areas)).toBeNull()
  })
})

describe('accepting AI rewrites of report sentences', () => {
  const claims: Claim[] = [
    { id: 'a', findingId: 'functional_burden', section: 'impact', text: 'Symptoms got in the way on 12 of 80 days (15%).', assertedValues: { limitingDays: 12, observedDays: 80, limitingRatePct: 15 }, evidenceDates: [] },
    { id: 'b', findingId: 'medication_summary', section: 'medication', text: 'Painkillers were recorded on 9 days.', assertedValues: { daysWithMedication: 9 }, evidenceDates: [] },
  ]

  it('keeps checked rewrites and drops failing or unknown ones', () => {
    const out = acceptRewrites({
      sentences: [
        { id: 'a', text: 'Symptoms disrupted 12 of 80 logged days (15%).' },
        { id: 'b', text: 'Painkillers were taken on 19 days.' },
        { id: 'zzz', text: 'Something else.' },
      ],
    }, claims)
    expect(out).toEqual({ a: 'Symptoms disrupted 12 of 80 logged days (15%).' })
  })

  it('treats a malformed answer as no rewrites', () => {
    expect(acceptRewrites(null, claims)).toEqual({})
    expect(acceptRewrites({ sentences: 'x' }, claims)).toEqual({})
  })
})
