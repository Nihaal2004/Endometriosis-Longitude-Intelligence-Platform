/**
 * aiAssist.ts — the two AI helpers beyond symptom wording, on the device side.
 *
 * Both need the "AI help" consent (ai_symptom_wording) and an account, and both
 * only ever suggest:
 * - interpretDay: casual words about a day -> proposed check-in answers. The
 *   patient sees "I understood this" and fills the form only if she chooses to.
 * - summariseClaims: AI rewrites of the report's checked sentences. Each rewrite
 *   is gated again here (verifySummarySentence); a failed one keeps the original.
 *
 * Any failure (no consent, offline, an answer that does not validate) returns
 * null, and the app carries on without AI.
 */

import { verifySummarySentence } from '../engine/fidelity'
import { BLEEDING_LEVELS, type BleedingLevel, type Claim } from '../engine/types'
import type { CatalogEntry } from './interpret'
import { supabase } from './supabase'

export interface DayInterpretation {
  bleeding: BleedingLevel | null
  pain: number | null
  symptomIds: string[]
  /** Symptoms she mentioned that aren't on her list; shown, never added silently. */
  unmatched: string[]
  impact: 0 | 1 | 2 | 3 | null
  areas: string[]
  medications: string[]
}

const strings = (v: unknown, pattern: RegExp, max: number) =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && pattern.test(x)))].slice(0, max) : []

/** Re-check the function's answer on the device: fixed choices only, symptoms from her own list. */
export function validateDayInterpretation(
  raw: unknown,
  catalog: CatalogEntry[],
  areaKeys: string[],
): DayInterpretation | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const ids = new Set(catalog.map((c) => c.id))
  const result: DayInterpretation = {
    bleeding: BLEEDING_LEVELS.includes(r.bleeding as BleedingLevel) ? (r.bleeding as BleedingLevel) : null,
    pain: Number.isInteger(r.pain) && (r.pain as number) >= 0 && (r.pain as number) <= 10 ? (r.pain as number) : null,
    symptomIds: strings(r.symptomIds, /^[a-z0-9_]{1,60}$/, 8).filter((id) => ids.has(id)),
    unmatched: strings(r.unmatched, /^[A-Za-z][A-Za-z '’-]{1,59}$/, 5),
    impact: [0, 1, 2, 3].includes(r.impact as number) ? (r.impact as DayInterpretation['impact']) : null,
    areas: [],
    medications: strings(r.medications, /^[A-Za-z][A-Za-z .'-]{1,39}$/, 5),
  }
  if (result.impact !== null && result.impact >= 2) {
    result.areas = strings(r.areas, /^[a-z ]{1,30}$/, 10).filter((a) => areaKeys.includes(a))
  }
  const empty = result.bleeding === null && result.pain === null && result.symptomIds.length === 0 &&
    result.unmatched.length === 0 && result.impact === null && result.medications.length === 0
  return empty ? null : result
}

export async function interpretDay(
  text: string,
  catalog: CatalogEntry[],
  medications: string[],
  areaKeys: string[],
): Promise<DayInterpretation | null> {
  if (!supabase || !text.trim()) return null
  try {
    const { data, error } = await supabase.functions.invoke('interpret-day', {
      body: { text: text.trim().slice(0, 600), catalog, medications, areas: areaKeys },
    })
    if (error) return null
    return validateDayInterpretation(data, catalog, areaKeys)
  } catch {
    return null
  }
}

/** Keep only rewrites of claims we sent, each through the summary gate. */
export function acceptRewrites(raw: unknown, claims: Claim[]): Record<string, string> {
  const out: Record<string, string> = {}
  const sentences = (raw as { sentences?: unknown })?.sentences
  if (!Array.isArray(sentences)) return out
  for (const s of sentences) {
    const claim = claims.find((c) => c.id === s?.id)
    if (claim && typeof s.text === 'string' && verifySummarySentence(claim, s.text)) out[claim.id] = s.text.trim()
  }
  return out
}

/** Returns checked rewrites by claim id, or null if the AI couldn't be reached. */
export async function summariseClaims(claims: Claim[]): Promise<Record<string, string> | null> {
  if (!supabase || claims.length === 0) return null
  try {
    const { data, error } = await supabase.functions.invoke('summarise-brief', {
      body: { claims: claims.map((c) => ({ id: c.id, text: c.text })) },
    })
    if (error) return null
    return acceptRewrites(data, claims)
  } catch {
    return null
  }
}
