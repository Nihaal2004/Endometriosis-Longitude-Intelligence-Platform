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

import type { SymptomDefinition } from './types'

export const SYMPTOMS: SymptomDefinition[] = [
  // --- Pain -----------------------------------------------------------------
  { id: 'pelvic_pain', label: 'Pelvic pain', domain: 'pain', graded: true },
  { id: 'lower_abdominal_pain', label: 'Lower abdominal pain', domain: 'pain', graded: true },
  { id: 'menstrual_pain', label: 'Period pain', clinicalTerm: 'Dysmenorrhoea', domain: 'pain', graded: true },
  { id: 'ovulation_pain', label: 'Mid-cycle pain', clinicalTerm: 'Mittelschmerz', domain: 'pain', graded: true },
  { id: 'lower_back_pain', label: 'Lower back pain', domain: 'pain', graded: true },
  { id: 'hip_pain', label: 'Hip pain', domain: 'pain', graded: true },
  { id: 'leg_pain', label: 'Leg pain', domain: 'pain', graded: true },
  { id: 'groin_pain', label: 'Groin pain', domain: 'pain', graded: true },
  { id: 'rectal_pain', label: 'Rectal pain or pressure', domain: 'pain', graded: true },

  // --- Bowel ----------------------------------------------------------------
  { id: 'painful_bm', label: 'Pain opening bowels', clinicalTerm: 'Dyschezia', domain: 'bowel', graded: true },
  { id: 'bloating', label: 'Bloating', domain: 'bowel', graded: true },
  { id: 'abdominal_distension', label: 'Abdominal swelling', clinicalTerm: 'Abdominal distension', domain: 'bowel', graded: true },
  { id: 'constipation', label: 'Constipation', domain: 'bowel', graded: false },
  { id: 'diarrhoea', label: 'Diarrhoea', domain: 'bowel', graded: false },
  { id: 'nausea', label: 'Nausea', domain: 'bowel', graded: true },
  { id: 'vomiting', label: 'Vomiting', domain: 'bowel', graded: false },
  { id: 'rectal_bleeding', label: 'Bleeding from bowel', clinicalTerm: 'Rectal bleeding', domain: 'bowel', graded: false },
  { id: 'bowel_urgency', label: 'Bowel urgency', domain: 'bowel', graded: false },

  // --- Urinary --------------------------------------------------------------
  { id: 'dysuria', label: 'Pain passing urine', clinicalTerm: 'Dysuria', domain: 'urinary', graded: true },
  { id: 'bladder_pain', label: 'Bladder pain', domain: 'urinary', graded: true },
  { id: 'urinary_urgency', label: 'Urinary urgency', domain: 'urinary', graded: false },
  { id: 'urinary_frequency', label: 'Passing urine often', clinicalTerm: 'Urinary frequency', domain: 'urinary', graded: false },
  { id: 'incomplete_emptying', label: 'Trouble emptying bladder', domain: 'urinary', graded: false },
  { id: 'haematuria', label: 'Blood in urine', clinicalTerm: 'Haematuria', domain: 'urinary', graded: false },

  // --- Systemic -------------------------------------------------------------
  { id: 'fatigue', label: 'Fatigue', domain: 'systemic', graded: true },
  { id: 'dizziness', label: 'Dizziness', domain: 'systemic', graded: false },
  { id: 'headache', label: 'Headache or migraine', domain: 'systemic', graded: true },
  { id: 'sleep_disturbance', label: 'Disturbed sleep', domain: 'systemic', graded: false },
  { id: 'low_mood', label: 'Low mood', domain: 'systemic', graded: true },

  // --- Sexual (optional module, never asked unprompted) ----------------------
  { id: 'dyspareunia', label: 'Pain during sex', clinicalTerm: 'Dyspareunia', domain: 'sexual', graded: true, sensitive: true },
  { id: 'post_coital_pain', label: 'Pain after sex', clinicalTerm: 'Post-coital pain', domain: 'sexual', graded: true, sensitive: true },
  { id: 'intimacy_avoidance', label: 'Avoided intimacy due to pain', domain: 'sexual', graded: false, sensitive: true },

  // --- Rare / extrapelvic (behind "add another symptom") ---------------------
  { id: 'cyclical_shoulder_pain', label: 'Shoulder pain around periods', domain: 'extrapelvic', graded: true, rare: true },
  { id: 'cyclical_chest_pain', label: 'Chest pain around periods', domain: 'extrapelvic', graded: true, rare: true },
  { id: 'cyclical_cough', label: 'Cough around periods', domain: 'extrapelvic', graded: false, rare: true },
  { id: 'scar_pain', label: 'Scar pain or swelling', domain: 'extrapelvic', graded: true, rare: true },
  { id: 'breathlessness', label: 'Breathlessness around periods', domain: 'extrapelvic', graded: false, rare: true },
]

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
