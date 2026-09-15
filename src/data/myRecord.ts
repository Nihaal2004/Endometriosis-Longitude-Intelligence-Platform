/**
 * myRecord.ts — The non-demo patient: an empty record a real user actually fills in.
 *
 * Everything under src/data/personas.ts is synthetic, generated from a seeded process
 * — that's deliberate (docs/PRIVACY.md §4) and the proposal's own deliverable #3 wants
 * synthetic demo journeys kept. But an app whose only content is three pre-generated
 * people is not a working tool for anyone using it as themselves. This is that: zero
 * days, zero findings, built once from whatever baseline the user chose to answer (all
 * optional — PRD §5 already says the model needs none of it), and grown entirely by
 * what gets logged through Today from here on.
 */

import type { PatientProfile, PatientRecord } from '../engine/types'
import { DEFAULT_TRACKED_SYMPTOMS } from '../engine/symptoms'

export const MY_RECORD_ID = 'me'

export interface MyProfileInput {
  ageRange?: string
  diagnosisStatus?: PatientProfile['diagnosisStatus']
  cycleRegularity?: PatientProfile['cycleRegularity']
  familyHistory?: boolean
}

export function buildMyRecord(input: MyProfileInput = {}): PatientRecord {
  return {
    profile: {
      id: MY_RECORD_ID,
      displayName: 'My record',
      diagnosisStatus: input.diagnosisStatus ?? 'undiagnosed',
      ageRange: input.ageRange,
      cycleRegularity: input.cycleRegularity,
      familyHistory: input.familyHistory,
      enabledDomains: ['pain', 'bowel', 'urinary', 'systemic'],
    },
    days: [],
    treatments: [],
    clinicalEvents: [],
    trackedSymptomIds: DEFAULT_TRACKED_SYMPTOMS,
  }
}
