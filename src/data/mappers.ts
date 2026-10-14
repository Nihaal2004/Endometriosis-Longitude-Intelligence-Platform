/**
 * mappers.ts — database rows ⇄ engine types.
 *
 * The rows mirror supabase/migrations/*_init.sql column for column. The engine
 * types are unchanged from the prototype. Everything in between is here, and it
 * is pure, so it is tested directly.
 *
 * The invariant this file guards: a symptom the patient was not asked about is
 * represented by its key being ABSENT from `symptoms`. It is never written as
 * `{state: 'unknown'}` and never defaulted to `absent`. `dayToRow` strips any
 * 'unknown' it is handed, and the database rejects one if it ever gets through.
 */

import type {
  BleedingLevel,
  ClinicalEvent,
  ClinicalEventKind,
  DayRecord,
  ImpactLevel,
  MedicationEntry,
  PatientProfile,
  SymptomDomain,
  SymptomObservation,
  TreatmentEpisode,
  TreatmentKind,
} from '../engine/types'

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface SyncedRow {
  client_updated_at: string
  deleted_at: string | null
  updated_at?: string
}

export interface DayEntryRow extends SyncedRow {
  id: string
  user_id?: string
  date: string
  bleeding: BleedingLevel | null
  impact: number | null
  impact_domains: string[] | null
  symptoms: Record<string, { state: 'present' | 'absent'; severity?: number }>
  medications: MedicationEntry[]
  depth: 'quick' | 'standard' | 'detailed' | null
  note: string | null
  revision?: number
}

export interface TreatmentRow extends SyncedRow {
  id: string
  user_id?: string
  kind: TreatmentKind
  label: string
  start_date: string
  end_date: string | null
  dose: string | null
  reason: string | null
  side_effects: string[]
  patient_perceived_change: TreatmentEpisode['patientPerceivedChange'] | null
  indication_symptom_id: string | null
}

export interface ClinicalEventRow extends SyncedRow {
  id: string
  user_id?: string
  kind: ClinicalEventKind
  date: string
  label: string
  reason: string | null
  outcome: string | null
  note: string | null
}

export interface CustomSymptomRow extends SyncedRow {
  id: string
  user_id?: string
  symptom_key: string
  label: string
  domain: SymptomDomain
  graded: boolean
}

export interface ProfileRow {
  user_id: string
  display_name: string | null
  age_range: string | null
  diagnosis_status: PatientProfile['diagnosisStatus']
  symptom_onset_year: number | null
  family_history: boolean | null
  previous_pelvic_surgery: boolean | null
  prior_labels: string[]
  usual_cycle_min: number | null
  usual_cycle_max: number | null
  cycle_regularity: PatientProfile['cycleRegularity'] | null
  age_at_menarche: number | null
  enabled_domains: SymptomDomain[]
  tracked_symptom_ids: string[]
  reminder: 'daily' | 'period' | 'none'
  reminder_time: string | null
  age_confirmed_18: boolean
  onboarded_at: string | null
  updated_at?: string
}

// ---------------------------------------------------------------------------
// Day entries
// ---------------------------------------------------------------------------

/**
 * Keep only real observations. 'unknown' and malformed values are dropped, so
 * they read back as unknown (absent key) — the one representation we allow.
 */
export function cleanSymptoms(
  symptoms: Record<string, SymptomObservation>,
): DayEntryRow['symptoms'] {
  const out: DayEntryRow['symptoms'] = {}
  for (const [id, obs] of Object.entries(symptoms)) {
    if (!obs || (obs.state !== 'present' && obs.state !== 'absent')) continue
    const value: { state: 'present' | 'absent'; severity?: number } = { state: obs.state }
    // Severity only means something for a present symptom, and only if the
    // patient actually gave one. Never default it.
    if (
      obs.state === 'present' &&
      typeof obs.severity === 'number' &&
      Number.isFinite(obs.severity)
    ) {
      value.severity = Math.max(0, Math.min(10, Math.round(obs.severity)))
    }
    out[id] = value
  }
  return out
}

export function dayToRow(
  day: DayRecord,
  id: string,
  clientUpdatedAt: string,
): DayEntryRow {
  return {
    id,
    date: day.date,
    bleeding: day.bleeding ?? null,
    impact: day.impact ?? null,
    impact_domains: day.impactDomains && day.impactDomains.length > 0 ? day.impactDomains : null,
    symptoms: cleanSymptoms(day.symptoms),
    medications: day.medications ?? [],
    depth: day.depth ?? null,
    note: day.note?.trim() ? day.note.trim() : null,
    client_updated_at: clientUpdatedAt,
    deleted_at: null,
  }
}

/** A cleared (soft-deleted) row is not a day record at all: the day is unknown. */
export function rowToDay(row: DayEntryRow): DayRecord | null {
  if (row.deleted_at) return null
  const symptoms: Record<string, SymptomObservation> = {}
  for (const [id, obs] of Object.entries(row.symptoms ?? {})) {
    symptoms[id] =
      obs.severity !== undefined && obs.severity !== null
        ? { state: obs.state, severity: obs.severity }
        : { state: obs.state }
  }
  return {
    date: row.date,
    logged: true,
    bleeding: row.bleeding ?? undefined,
    impact: (row.impact ?? undefined) as ImpactLevel | undefined,
    impactDomains: row.impact_domains ?? undefined,
    symptoms,
    medications: row.medications && row.medications.length > 0 ? row.medications : undefined,
    depth: row.depth ?? undefined,
    note: row.note ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// Treatments and clinical events
// ---------------------------------------------------------------------------

export function treatmentToRow(t: TreatmentEpisode, clientUpdatedAt: string): TreatmentRow {
  return {
    id: t.id,
    kind: t.kind,
    label: t.label.trim(),
    start_date: t.startDate,
    end_date: t.endDate ?? null,
    dose: t.dose?.trim() || null,
    reason: t.reason?.trim() || null,
    side_effects: t.sideEffects ?? [],
    patient_perceived_change: t.patientPerceivedChange ?? null,
    indication_symptom_id: t.indicationSymptomId ?? null,
    client_updated_at: clientUpdatedAt,
    deleted_at: null,
  }
}

export function rowToTreatment(row: TreatmentRow): TreatmentEpisode | null {
  if (row.deleted_at) return null
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    startDate: row.start_date,
    endDate: row.end_date ?? undefined,
    dose: row.dose ?? undefined,
    reason: row.reason ?? undefined,
    sideEffects: row.side_effects?.length ? row.side_effects : undefined,
    patientPerceivedChange: row.patient_perceived_change ?? undefined,
    indicationSymptomId: row.indication_symptom_id ?? undefined,
  }
}

export function eventToRow(e: ClinicalEvent, clientUpdatedAt: string): ClinicalEventRow {
  return {
    id: e.id,
    kind: e.kind,
    date: e.date,
    label: e.label.trim(),
    reason: e.reason?.trim() || null,
    outcome: e.outcome?.trim() || null,
    note: e.note?.trim() || null,
    client_updated_at: clientUpdatedAt,
    deleted_at: null,
  }
}

export function rowToEvent(row: ClinicalEventRow): ClinicalEvent | null {
  if (row.deleted_at) return null
  return {
    id: row.id,
    kind: row.kind,
    date: row.date,
    label: row.label,
    reason: row.reason ?? undefined,
    outcome: row.outcome ?? undefined,
    note: row.note ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function rowToProfile(row: ProfileRow, displayNameFallback: string): PatientProfile {
  return {
    id: row.user_id,
    displayName: row.display_name || displayNameFallback,
    ageRange: row.age_range ?? undefined,
    diagnosisStatus: row.diagnosis_status,
    symptomOnsetYear: row.symptom_onset_year ?? undefined,
    familyHistory: row.family_history ?? undefined,
    previousPelvicSurgery: row.previous_pelvic_surgery ?? undefined,
    priorLabels: row.prior_labels?.length ? row.prior_labels : undefined,
    usualCycleLength:
      row.usual_cycle_min && row.usual_cycle_max
        ? [row.usual_cycle_min, row.usual_cycle_max]
        : undefined,
    cycleRegularity: row.cycle_regularity ?? undefined,
    ageAtMenarche: row.age_at_menarche ?? undefined,
    enabledDomains: row.enabled_domains,
  }
}

/** Patient-defined symptom keys are namespaced so they can never collide with the vocabulary. */
export function customSymptomKey(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return `custom_${slug || 'symptom'}`
}
