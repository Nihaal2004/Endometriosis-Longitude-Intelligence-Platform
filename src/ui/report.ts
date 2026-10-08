import type { Claim, ClinicalEvent, Finding, PatientProfile, PatientRecord, TreatmentEpisode } from '../engine/types'

export interface SavedReport {
  reviewed?: boolean
  visitDate?: string
  safetyStatement?: string
  scope?: { domains: string[]; sections: string[]; start: string; end: string; treatments: boolean; events: boolean; cycle: boolean; fertility: boolean; privateNotes: boolean }
  patientNote: string
  claims: Claim[]
  findings: Finding[]
  concerns: string[]
  windowStart: string
  windowEnd: string
  profile: PatientProfile
  clinicalEvents: ClinicalEvent[]
  treatments: TreatmentEpisode[]
  sourceRecord: PatientRecord
  recordRevision: number
  engineVersion: string
  savedAt: string
}
export interface ReportListItem { id: string; record_revision: number; recorded_at: string }
