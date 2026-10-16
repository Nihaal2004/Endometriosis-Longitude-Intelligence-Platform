/**
 * interpret.ts — suggest the clinical term for a symptom described in the
 * patient's own words (supabase/functions/interpret-symptom).
 *
 * Only ever a suggestion: the patient confirms it before it is stored, and any
 * failure (no consent, offline, an answer that does not validate) returns null
 * so the patient's own words are saved exactly as before. Logging never waits
 * on this.
 */

import type { SymptomDomain } from '../engine/types'
import { supabase } from './supabase'

export interface CatalogEntry {
  id: string
  label: string
  clinicalTerm?: string
}

export type Interpretation =
  | { match: 'catalog'; catalogId: string; domain: SymptomDomain; graded: boolean }
  | { match: 'new'; clinicalTerm: string; domain: SymptomDomain; graded: boolean }

const DOMAINS: SymptomDomain[] = ['pain', 'bowel', 'urinary', 'systemic', 'sexual', 'extrapelvic']

/** No digits: the brief's fidelity gate audits every number in the prose. */
const TERM_PATTERN = /^[A-Za-z][A-Za-z '’(),/-]{1,79}$/

/**
 * Re-check the function's answer on the device. The server validates too; this
 * keeps a misbehaving or stale function from putting anything odd in a report.
 */
export function validateInterpretation(raw: unknown, catalog: CatalogEntry[]): Interpretation | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const domain = DOMAINS.includes(r.domain as SymptomDomain) ? (r.domain as SymptomDomain) : 'pain'
  const graded = r.graded !== false

  if (r.match === 'catalog' && typeof r.catalogId === 'string' && catalog.some((c) => c.id === r.catalogId)) {
    return { match: 'catalog', catalogId: r.catalogId, domain, graded }
  }
  const term = typeof r.clinicalTerm === 'string' ? r.clinicalTerm.trim() : ''
  if (r.match === 'new' && TERM_PATTERN.test(term)) {
    return { match: 'new', clinicalTerm: term, domain, graded }
  }
  return null
}

export async function interpretSymptom(text: string, catalog: CatalogEntry[]): Promise<Interpretation | null> {
  if (!supabase || !text.trim()) return null
  try {
    const { data, error } = await supabase.functions.invoke('interpret-symptom', {
      body: { text: text.trim().slice(0, 60), catalog },
    })
    if (error) return null
    return validateInterpretation(data, catalog)
  } catch {
    return null
  }
}
