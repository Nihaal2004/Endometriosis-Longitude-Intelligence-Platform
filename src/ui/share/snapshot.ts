/**
 * snapshot.ts — the exact document a clinician receives.
 *
 * A share link never grants access to the account. It points at one immutable
 * snapshot, built here from verified claims only, containing only the sections
 * the patient ticked. The patient previews this same object before creating
 * the link, so what she approves is byte-for-byte what is shared.
 *
 * Sexual-health content is excluded unless explicitly included each time.
 */

import { getSymptom, clinicalLabel } from '../../engine/symptoms'
import { SAFETY_STATEMENT } from '../../engine/brief'
import type { BriefSection, Claim, ClinicalEvent, PatientRecord, TreatmentEpisode } from '../../engine/types'

export const SNAPSHOT_VERSION = 1

export type ShareSectionId =
  | 'concerns'
  | 'findings'
  | 'impact'
  | 'change'
  | 'medication'
  | 'timeline'
  | 'sexual_health'

export const SHARE_SECTIONS: { id: ShareSectionId; title: string; defaultOn: boolean; note?: string }[] = [
  { id: 'concerns', title: 'Main concerns', defaultOn: true },
  { id: 'findings', title: 'Longitudinal findings', defaultOn: true },
  { id: 'impact', title: 'Functional impact', defaultOn: true },
  { id: 'change', title: 'Change from previous cycles', defaultOn: true },
  { id: 'medication', title: 'Medication and treatment', defaultOn: true },
  { id: 'timeline', title: 'Appointments and tests', defaultOn: true },
  {
    id: 'sexual_health',
    title: 'Sexual-health findings',
    defaultOn: false,
    note: 'Off unless you include it for this report.',
  },
]

/** The recorded period and data-quality statement are always included: without them the rest can't be read fairly. */
const ALWAYS: BriefSection[] = ['period', 'quality']

export interface SharedClaim {
  text: string
}

export interface SharedReport {
  version: number
  createdAt: string
  patient: {
    displayName?: string
    diagnosisStatus: PatientRecord['profile']['diagnosisStatus']
    priorLabels?: string[]
  }
  period: {
    start: string
    end: string
    loggedDays: number
    calendarDays: number
    completeCycles: number
  }
  concerns?: string[]
  sections: { id: string; title: string; claims: SharedClaim[] }[]
  treatments?: Pick<TreatmentEpisode, 'label' | 'startDate' | 'endDate'>[]
  timeline?: Pick<ClinicalEvent, 'date' | 'label' | 'reason' | 'outcome'>[]
  safetyStatement: string
  verification: { verifiedClaims: number }
}

const SECTION_TITLES: Partial<Record<BriefSection, string>> = {
  period: 'Recorded period',
  findings: 'Longitudinal findings',
  impact: 'Functional impact',
  change: 'Change from previous cycles',
  medication: 'Medication and treatment',
  quality: 'Data quality',
}

/** True if a claim is about a symptom in the sexual-health module. */
export function isSexualHealthClaim(claim: Claim): boolean {
  const ids = claim.findingId.split(':').slice(1)
  return ids.some((id) => getSymptom(id)?.domain === 'sexual')
}

export function buildShareSnapshot(input: {
  claims: Claim[]
  record: PatientRecord
  window: { start: string; end: string; loggedDays: number; calendarDays: number; completeCycles: number }
  concerns: string[]
  selected: Set<ShareSectionId>
  createdAt?: string
}): SharedReport {
  const { claims, record, selected } = input
  const includeSexual = selected.has('sexual_health')

  const allowed = (claim: Claim): boolean => {
    if (claim.verified === false) return false // never share a claim that failed verification
    if (isSexualHealthClaim(claim) && !includeSexual) return false
    if (ALWAYS.includes(claim.section)) return true
    return selected.has(claim.section as ShareSectionId)
  }

  const order: BriefSection[] = ['period', 'findings', 'impact', 'change', 'medication', 'quality']
  const sections = order
    .map((id) => ({
      id,
      title: SECTION_TITLES[id] ?? id,
      claims: claims.filter((c) => c.section === id && allowed(c)).map((c) => ({ text: c.text })),
    }))
    .filter((s) => s.claims.length > 0)

  // Concerns are clinical labels of the most burdensome symptoms; sexual-health
  // ones follow the same opt-in rule as the findings.
  const sexualLabels = new Set(
    record.trackedSymptomIds.filter((id) => getSymptom(id)?.domain === 'sexual').map((id) => clinicalLabel(id)),
  )
  const concerns = selected.has('concerns')
    ? input.concerns.filter((c) => includeSexual || !sexualLabels.has(c))
    : undefined

  const report: SharedReport = {
    version: SNAPSHOT_VERSION,
    createdAt: input.createdAt ?? new Date().toISOString(),
    patient: {
      displayName: record.profile.displayName || undefined,
      diagnosisStatus: record.profile.diagnosisStatus,
      priorLabels: record.profile.priorLabels?.length ? record.profile.priorLabels : undefined,
    },
    period: { ...input.window },
    concerns,
    sections,
    safetyStatement: SAFETY_STATEMENT,
    verification: { verifiedClaims: sections.reduce((n, s) => n + s.claims.length, 0) },
  }

  if (selected.has('medication') && record.treatments.length > 0) {
    report.treatments = record.treatments.map((t) => ({ label: t.label, startDate: t.startDate, endDate: t.endDate }))
  }
  if (selected.has('timeline') && record.clinicalEvents.length > 0) {
    report.timeline = [...record.clinicalEvents]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({ date: e.date, label: e.label, reason: e.reason, outcome: e.outcome }))
  }

  return report
}
