/**
 * symptoms.ts — The symptom vocabulary.
 *
 * Domains follow the patient-reported-outcome literature for endometriosis, which is
 * consistent that burden is multidimensional: pelvic pain alone is an inadequate
 * representation, and bowel, urinary, systemic/fatigue, sexual and extrapelvic
 * domains all carry clinically relevant signal.
 *
 * `clinicalTerm` exists so the patient always reads their own words while the
 * clinician brief uses the term a gynaecologist expects — the patient sees
 * "pain opening bowels", the brief says "dyschezia".
 */

import type { SymptomDefinition, SymptomDomain } from './types'

// Shared with the SQLite API so collection and analysis use the same IDs.
import vocabulary from '../../shared/symptoms.json'

export const SYMPTOMS: SymptomDefinition[] = vocabulary.map(s => ({ ...s, domain: s.domain as SymptomDomain }))

const BY_ID = new Map(SYMPTOMS.map((s) => [s.id, s]))

export function getSymptom(id: string): SymptomDefinition | undefined {
  return BY_ID.get(id)
}

/** Patient-facing label, falling back to the id for patient-defined symptoms. */
export function symptomLabel(id: string, custom?: Record<string, string>): string {
  return custom?.[id] ?? BY_ID.get(id)?.label ?? id
}

/** Label used in the clinician brief. Prefers the clinical term where one exists. */
export function clinicalLabel(id: string, custom?: Record<string, string>): string {
  const def = BY_ID.get(id)
  if (!def) return custom?.[id] ?? id
  return def.clinicalTerm ?? def.label
}

export function symptomsByDomain(domain: string): SymptomDefinition[] {
  return SYMPTOMS.filter((s) => s.domain === domain)
}

/** The symptoms shown to a new patient before personalisation has anything to go on. */
export const DEFAULT_TRACKED_SYMPTOMS = [
  'pelvic_pain',
  'menstrual_pain',
  'fatigue',
  'bloating',
  'painful_bm',
  'lower_back_pain',
]
