/**
 * personas.ts — The three demonstration patients.
 *
 * Each exists to exercise a different behaviour of the engine, so that every claim the
 * product makes can be shown rather than described:
 *
 *   MAYA   — a textbook perimenstrual pattern with rising functional burden. Shows
 *            cyclicity detection, trend, co-occurrence and a full clinician brief.
 *   PRIYA  — persistent non-cyclical pain with a treatment episode part-way through.
 *            Shows before/during comparison and the persistence finding, and is the
 *            case a cycle-only tracker would describe as "nothing unusual".
 *   AISHA  — a sparse logger, ~45% coverage. Shows the evidence gate refusing to
 *            report, which is the behaviour that separates this from a tracker that
 *            will happily draw a trend line through four data points.
 *
 * They are generated from the same seeded process as the evaluation cohort, so the
 * demo data is not hand-tuned to flatter the engine.
 */

import { generatePatient, type GeneratorConfig } from './generator'
import type { PatientRecord } from '../engine/types'

const END_DATE = '2026-09-14'

export interface Persona {
  id: string
  name: string
  age: number
  /** One line shown on the persona switcher. */
  tagline: string
  /** What this persona is here to demonstrate. */
  demonstrates: string
  record: PatientRecord
}

// ---------------------------------------------------------------------------
// Maya — clear perimenstrual pattern
// ---------------------------------------------------------------------------

const mayaConfig: GeneratorConfig = {
  patientId: 'maya',
  displayName: 'Maya',
  seed: 'persona:maya:v1',
  days: 188,
  endDate: END_DATE,
  meanCycleLength: 29,
  cycleLengthSd: 2.5,
  meanBleedDays: 6,
  missingness: { mode: 'mar', rate: 0.14 },
  symptoms: [
    { id: 'menstrual_pain', cyclical: true, kappa: 9, mu: 0.15, baseRate: 0.01, amplitude: 0.85, severityMean: 6, askProbability: 0.97 },
    { id: 'pelvic_pain', cyclical: true, kappa: 3.2, mu: -0.15, baseRate: 0.16, amplitude: 0.55, severityMean: 6, askProbability: 0.96 },
    { id: 'painful_bm', cyclical: true, kappa: 7, mu: -0.1, baseRate: 0.03, amplitude: 0.72, severityMean: 5, askProbability: 0.88 },
    { id: 'bloating', cyclical: true, kappa: 2.6, mu: -0.3, baseRate: 0.14, amplitude: 0.45, severityMean: 4, askProbability: 0.85 },
    { id: 'fatigue', cyclical: false, kappa: 0, mu: 0, baseRate: 0.3, amplitude: 0.12, drift: 0.035, severityMean: 5, askProbability: 0.9 },
    { id: 'lower_back_pain', cyclical: true, kappa: 4, mu: 0.1, baseRate: 0.08, amplitude: 0.4, severityMean: 4, askProbability: 0.7 },
    { id: 'urinary_urgency', cyclical: false, kappa: 0, mu: 0, baseRate: 0.02, amplitude: 0.01, severityMean: 3, askProbability: 0.35, graded: false },
  ],
  profile: {
    ageRange: '24',
    diagnosisStatus: 'suspected',
    symptomOnsetYear: 2019,
    familyHistory: true,
    ageAtMenarche: 12,
    cycleRegularity: 'regular',
    priorLabels: ['Irritable bowel syndrome (2023)', 'Primary dysmenorrhoea (2021)'],
    enabledDomains: ['pain', 'bowel', 'urinary', 'systemic'],
  },
  clinicalEvents: [
    { id: 'e1', kind: 'gp', date: '2026-04-02', label: 'GP appointment', reason: 'Severe period pain, missed work', outcome: 'Advised mefenamic acid; reassurance' },
    { id: 'e2', kind: 'gp', date: '2026-06-18', label: 'GP appointment', reason: 'Ongoing pain, bowel symptoms', outcome: 'Referred for pelvic ultrasound' },
    { id: 'e3', kind: 'ultrasound', date: '2026-07-21', label: 'Transvaginal ultrasound', reason: 'Pelvic pain', outcome: 'No abnormality detected' },
    { id: 'e4', kind: 'referral', date: '2026-08-28', label: 'Gynaecology referral', reason: 'Persistent symptoms despite normal imaging' },
  ],
}

// ---------------------------------------------------------------------------
// Priya — persistent pain, treatment episode mid-record
// ---------------------------------------------------------------------------

const priyaConfig: GeneratorConfig = {
  patientId: 'priya',
  displayName: 'Priya',
  seed: 'persona:priya:v3',
  days: 188,
  endDate: END_DATE,
  meanCycleLength: 33,
  cycleLengthSd: 6,
  meanBleedDays: 7,
  missingness: { mode: 'mcar', rate: 0.1 },
  symptoms: [
    { id: 'pelvic_pain', cyclical: false, kappa: 0, mu: 0, baseRate: 0.52, amplitude: 0.1, severityMean: 6, askProbability: 0.98 },
    { id: 'lower_back_pain', cyclical: false, kappa: 0, mu: 0, baseRate: 0.3, amplitude: 0.08, severityMean: 5, askProbability: 0.9 },
    { id: 'fatigue', cyclical: false, kappa: 0, mu: 0, baseRate: 0.42, amplitude: 0.1, severityMean: 5, askProbability: 0.92 },
    { id: 'menstrual_pain', cyclical: true, kappa: 6, mu: 0.1, baseRate: 0.02, amplitude: 0.6, severityMean: 6, askProbability: 0.95 },
    { id: 'bladder_pain', cyclical: false, kappa: 0, mu: 0, baseRate: 0.22, amplitude: 0.06, severityMean: 4, askProbability: 0.8 },
    { id: 'dysuria', cyclical: false, kappa: 0, mu: 0, baseRate: 0.14, amplitude: 0.05, severityMean: 4, askProbability: 0.7, graded: false },
    { id: 'headache', cyclical: false, kappa: 0, mu: 0, baseRate: 0.16, amplitude: 0.05, severityMean: 4, askProbability: 0.6 },
  ],
  profile: {
    ageRange: '31',
    diagnosisStatus: 'confirmed',
    symptomOnsetYear: 2014,
    previousPelvicSurgery: true,
    ageAtMenarche: 13,
    cycleRegularity: 'highly_irregular',
    priorLabels: ['Endometriosis, confirmed at laparoscopy (2024)', 'Recurrent UTI (2022)'],
    enabledDomains: ['pain', 'bowel', 'urinary', 'systemic'],
  },
  treatments: [
    {
      id: 'tx-progestin',
      kind: 'progestin',
      label: 'Norethisterone 5 mg',
      startDate: '2026-06-24',
      dose: '5 mg daily',
      reason: 'Persistent non-cyclical pelvic pain',
      sideEffects: ['Breakthrough bleeding', 'Low mood'],
      patientPerceivedChange: 'better',
    },
  ],
  clinicalEvents: [
    { id: 'p1', kind: 'laparoscopy', date: '2024-11-12', label: 'Diagnostic laparoscopy', outcome: 'Endometriosis confirmed, ASRM stage II; ablation performed' },
    { id: 'p2', kind: 'gynaecology', date: '2026-06-24', label: 'Gynaecology review', reason: 'Recurrent pain 18 months post-surgery', outcome: 'Started norethisterone' },
    { id: 'p3', kind: 'emergency', date: '2026-05-09', label: 'Emergency department', reason: 'Acute severe pelvic pain', outcome: 'Analgesia, discharged; no acute cause found' },
    { id: 'p4', kind: 'gynaecology', date: '2026-09-02', label: 'Gynaecology follow-up', reason: 'Treatment review' },
  ],
}

// ---------------------------------------------------------------------------
// Aisha — sparse logger, insufficient evidence
// ---------------------------------------------------------------------------

const aishaConfig: GeneratorConfig = {
  patientId: 'aisha',
  displayName: 'Aisha',
  seed: 'persona:aisha:v1',
  days: 96,
  endDate: END_DATE,
  meanCycleLength: 27,
  cycleLengthSd: 3,
  meanBleedDays: 5,
  // Deliberately sparse: this is what most real-world records look like in month one.
  missingness: { mode: 'mar', rate: 0.72 },
  symptoms: [
    { id: 'menstrual_pain', cyclical: true, kappa: 7, mu: 0.1, baseRate: 0.02, amplitude: 0.8, severityMean: 7, askProbability: 0.95 },
    { id: 'pelvic_pain', cyclical: true, kappa: 3, mu: 0, baseRate: 0.12, amplitude: 0.5, severityMean: 6, askProbability: 0.9 },
    { id: 'nausea', cyclical: true, kappa: 5, mu: 0.2, baseRate: 0.04, amplitude: 0.4, severityMean: 4, askProbability: 0.75 },
    { id: 'fatigue', cyclical: false, kappa: 0, mu: 0, baseRate: 0.3, amplitude: 0.1, severityMean: 5, askProbability: 0.85 },
  ],
  profile: {
    ageRange: '19',
    diagnosisStatus: 'undiagnosed',
    symptomOnsetYear: 2023,
    ageAtMenarche: 11,
    cycleRegularity: 'variable',
    enabledDomains: ['pain', 'bowel', 'systemic'],
  },
  clinicalEvents: [
    { id: 'a1', kind: 'gp', date: '2026-08-11', label: 'GP appointment', reason: 'Period pain affecting university attendance', outcome: 'Advised to start tracking symptoms and return in 3 months' },
  ],
}

// ---------------------------------------------------------------------------

export const PERSONAS: Persona[] = [
  {
    id: 'maya',
    name: 'Maya',
    age: 24,
    tagline: 'Suspected endometriosis · 6 months tracked',
    demonstrates:
      'A clear perimenstrual pattern across pain and bowel symptoms, with functional burden rising across cycles. Two GP visits and a normal ultrasound already on record.',
    record: generatePatient(mayaConfig),
  },
  {
    id: 'priya',
    name: 'Priya',
    age: 31,
    tagline: 'Confirmed endometriosis · on treatment',
    demonstrates:
      'Persistent, largely non-cyclical pain — the presentation a cycle-only tracker reads as unremarkable. Norethisterone started mid-record, giving a before/during comparison.',
    record: generatePatient(priyaConfig),
  },
  {
    id: 'aisha',
    name: 'Aisha',
    age: 19,
    tagline: 'Undiagnosed · tracking started recently',
    demonstrates:
      'A sparse record at around half coverage, below the evidence floor. The engine withholds every finding rather than reporting patterns it cannot support — and says so, instead of leaving them quietly absent.',
    record: generatePatient(aishaConfig),
  },
]

export function getPersona(id: string): Persona {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0]
}

/** Custom patient-worded labels, demonstrating patient-defined vocabulary. */
export const CUSTOM_LABELS: Record<string, Record<string, string>> = {
  maya: { painful_bm: 'Pain opening bowels' },
  priya: {},
  aisha: {},
}
