import { describe, expect, it } from 'vitest'
import {
  cleanSymptoms,
  customSymptomKey,
  dayToRow,
  rowToDay,
  rowToTreatment,
  treatmentToRow,
} from './mappers'
import { ImpactLevel, type DayRecord, type SymptomObservation } from '../engine/types'

const NOW = '2026-10-15T10:00:00.000Z'

describe('day entry mapping', () => {
  const day: DayRecord = {
    date: '2026-10-14',
    logged: true,
    bleeding: 'heavy',
    impact: ImpactLevel.ModifiedActivities,
    impactDomains: ['work'],
    symptoms: {
      pelvic_pain: { state: 'present', severity: 7 },
      fatigue: { state: 'absent' },
      bloating: { state: 'present' }, // presence only, no severity given
    },
    medications: [{ medicationId: 'ibuprofen', label: 'Ibuprofen' }],
    depth: 'standard',
  }

  it('round-trips a day exactly', () => {
    expect(rowToDay(dayToRow(day, 'id-1', NOW))).toEqual(day)
  })

  it('keeps an unasked symptom unknown — absent from the record, never "absent"', () => {
    const back = rowToDay(dayToRow(day, 'id-1', NOW))!
    expect(back.symptoms.painful_bm).toBeUndefined()
    expect('painful_bm' in back.symptoms).toBe(false)
  })

  it('distinguishes asked-and-absent from never-asked', () => {
    const back = rowToDay(dayToRow(day, 'id-1', NOW))!
    expect(back.symptoms.fatigue).toEqual({ state: 'absent' }) // asked, not present
    expect(back.symptoms.nausea).toBeUndefined() // never asked
  })

  it('strips an explicit "unknown" rather than storing it', () => {
    const withUnknown: Record<string, SymptomObservation> = {
      pelvic_pain: { state: 'unknown' },
      fatigue: { state: 'present', severity: 4 },
    }
    expect(cleanSymptoms(withUnknown)).toEqual({ fatigue: { state: 'present', severity: 4 } })
  })

  it('never invents a severity for a presence-only symptom', () => {
    const row = dayToRow(day, 'id-1', NOW)
    expect(row.symptoms.bloating).toEqual({ state: 'present' })
    expect('severity' in row.symptoms.bloating).toBe(false)
  })

  it('drops severity on an absent symptom, and clamps out-of-range values', () => {
    expect(
      cleanSymptoms({
        a: { state: 'absent', severity: 6 },
        b: { state: 'present', severity: 14 },
        c: { state: 'present', severity: -2 },
      }),
    ).toEqual({ a: { state: 'absent' }, b: { state: 'present', severity: 10 }, c: { state: 'present', severity: 0 } })
  })

  it('reads a cleared (soft-deleted) day as no record at all', () => {
    const row = { ...dayToRow(day, 'id-1', NOW), deleted_at: NOW }
    expect(rowToDay(row)).toBeNull()
  })

  it('stores empty optional fields as null, not empty values', () => {
    const minimal = dayToRow({ date: '2026-10-14', logged: true, symptoms: {}, note: '   ' }, 'id-2', NOW)
    expect(minimal.impact_domains).toBeNull()
    expect(minimal.note).toBeNull()
    expect(minimal.bleeding).toBeNull()
  })
})

describe('treatment mapping', () => {
  it('round-trips a treatment, including what it was prescribed for', () => {
    const t = {
      id: 't1',
      kind: 'progestin' as const,
      label: 'Norethisterone 5 mg',
      startDate: '2026-07-27',
      dose: '5 mg daily',
      reason: 'Pelvic pain',
      sideEffects: ['Low mood'],
      patientPerceivedChange: 'better' as const,
      indicationSymptomId: 'pelvic_pain',
    }
    expect(rowToTreatment(treatmentToRow(t, NOW))).toEqual(t)
  })
})

describe('custom symptom keys', () => {
  it('namespaces and slugs the patient’s wording', () => {
    expect(customSymptomKey('Sharp pain down my LEFT thigh!')).toBe('custom_sharp_pain_down_my_left_thigh')
    expect(customSymptomKey('   ')).toBe('custom_symptom')
  })

  it('matches the database constraint', () => {
    expect(customSymptomKey('A'.repeat(200))).toMatch(/^custom_[a-z0-9_]{1,48}$/)
  })
})
