/**
 * _shared/llm.ts — what the AI edge functions have in common.
 *
 * The model is MedGemma (Google, trained on medical text), run by MedTrace itself,
 * so patients' words go to no outside company. Configure with function secrets:
 *   LLM_API        'openai' (default: Ollama or any OpenAI-compatible server), or
 *                  'gradio' for the Hugging Face ZeroGPU Space in deploy/hf-space
 *   LLM_BASE_URL   default http://host.docker.internal:11434/v1 (Ollama on the dev
 *                  machine); for 'gradio', the Space's address
 *   LLM_MODEL      default medgemma:4b
 *   LLM_API_KEY    optional bearer token (the Space's access token). Pointing this at
 *                  an outside provider changes who receives health data: update the
 *                  privacy notice (src/ui/privacy.ts) first.
 *   LLM_TIMEOUT_MS optional, default 30000
 *
 * Rules every caller keeps:
 * - Consent (purpose ai_symptom_wording) is checked on the server, with the caller's
 *   own JWT, so row-level security decides whose consent is read.
 * - The model's answer is only ever a suggestion, validated here and again on the
 *   device, and the patient confirms it before anything is stored.
 * - Never log the patient's text, or anything derived from it.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const LLM_BASE_URL = (Deno.env.get('LLM_BASE_URL') ?? 'http://host.docker.internal:11434/v1').replace(/\/$/, '')
export const LLM_MODEL = Deno.env.get('LLM_MODEL') ?? 'medgemma:4b'
const LLM_API_KEY = Deno.env.get('LLM_API_KEY')
// A small model on a CPU can take a while; the patient's words are saved as typed if it does.
export const TIMEOUT_MS = Number(Deno.env.get('LLM_TIMEOUT_MS')) || 30_000
const LLM_API = Deno.env.get('LLM_API') === 'gradio' ? 'gradio' : 'openai'

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

export const DOMAINS = ['pain', 'bowel', 'urinary', 'systemic', 'sexual', 'extrapelvic'] as const

/** Handles CORS preflight and method; returns a response to send, or null to carry on. */
export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  return null
}

/** Reads the caller's AI consent as the caller. Returns an error response, or null when granted. */
export async function requireAiConsent(req: Request): Promise<Response | null> {
  const authorization = req.headers.get('Authorization')
  if (!authorization) return json({ error: 'unauthorized' }, 401)
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: consent, error } = await supabase
    .from('current_consents')
    .select('granted')
    .eq('purpose', 'ai_symptom_wording')
    .maybeSingle()
  if (error) return json({ error: 'unavailable' }, 503)
  if (!consent?.granted) return json({ error: 'no_consent' }, 403)
  return null
}

export class ModelError extends Error {
  constructor(readonly status: number) {
    super(`status ${status}`)
  }
}

/** Sends an OpenAI-style chat request and returns the reply text. */
export async function askModel(request: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const headers = {
    'Content-Type': 'application/json',
    ...(LLM_API_KEY ? { Authorization: `Bearer ${LLM_API_KEY}` } : {}),
  }
  if (LLM_API === 'openai') {
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(request), signal })
    if (!res.ok) throw new ModelError(res.status)
    const body = await res.json()
    return String(body?.choices?.[0]?.message?.content ?? '')
  }
  // Gradio: queue the call, then read the result from its event stream.
  const queued = await fetch(`${LLM_BASE_URL}/gradio_api/call/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data: [JSON.stringify(request)] }),
    signal,
  })
  if (!queued.ok) throw new ModelError(queued.status)
  const { event_id } = await queued.json()
  const res = await fetch(`${LLM_BASE_URL}/gradio_api/call/chat/${event_id}`, { headers, signal })
  if (!res.ok) throw new ModelError(res.status)
  const complete = (await res.text()).match(/event: complete\r?\ndata: (.*)/)
  if (!complete) throw new ModelError(502)
  return String(JSON.parse(complete[1])?.[0] ?? '')
}

/**
 * askModel, with failures turned into the response to send. Logs only the status or
 * the error's name: an error body can echo the patient's words.
 */
export async function askModelOrFail(
  fn: string,
  request: Record<string, unknown>,
  timeoutMs = TIMEOUT_MS,
): Promise<{ content: string } | { failed: Response }> {
  try {
    return { content: await askModel({ model: LLM_MODEL, temperature: 0, ...request }, AbortSignal.timeout(timeoutMs)) }
  } catch (error) {
    if (error instanceof ModelError) console.error(`${fn}: model call failed (${error.status})`)
    else console.error(`${fn}: model unreachable (${error instanceof Error ? error.name : 'error'})`)
    return { failed: json({ error: 'unavailable' }, 502) }
  }
}

/** Small models sometimes wrap JSON in a code fence despite the schema. */
export function parseModelJson(text: string): Record<string, unknown> | null {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const value = JSON.parse(unfenced)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    // Some models add a sentence around the object; take the outermost braces.
    const start = unfenced.indexOf('{')
    const end = unfenced.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      const value = JSON.parse(unfenced.slice(start, end + 1))
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null
    } catch {
      return null
    }
  }
}

// The app never suggests a diagnosis. A small model sometimes offers one anyway
// ("feel down and hopeless" -> "Depression"); then the patient keeps their words.
export const DIAGNOSES = /\b(depression|depressive|endometriosis|adenomyosis|pcos|polycystic|fibroids?|cancer|tumou?r|diabetes|hyperglyc|hypoglyc|thyroid|anaemia|anemia|infection|uti|ibs|irritable bowel|disorder|syndrome|disease|pmdd|cyst)\b/i

// ---- The app's symptom list, as sent by the client ---------------------------------

export interface CatalogEntry {
  id: string
  label: string
  clinicalTerm?: string
}

const MAX_CATALOG = 80

/** Keeps well-formed entries only, capped, with bounded strings. */
export function cleanCatalog(raw: unknown): CatalogEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((c) => typeof c?.id === 'string' && /^[a-z0-9_]{1,60}$/.test(c.id) && typeof c.label === 'string')
    .slice(0, MAX_CATALOG)
    .map((c) => ({
      id: c.id,
      label: c.label.slice(0, 60),
      clinicalTerm: typeof c.clinicalTerm === 'string' ? c.clinicalTerm.slice(0, 80) : undefined,
    }))
}

// ---- Matching a symptom name to the app's symptoms ----------------------------------
// Deterministic, so it can be read and tested. A name matches an entry when, after
// light normalisation, it equals the entry's label or clinical term, or shares most
// of its words ("low back pain" ~ "Lower back pain").

const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'my', 'and', 'or', 'during', 'around', 'period', 'periods', 'when', 'from'])

function tokens(x: string): string[] {
  return x
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w))
    .map((w) => (w === 'lower' ? 'low' : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
}

function similarity(a: string, b: string): number {
  const A = new Set(tokens(a))
  const B = new Set(tokens(b))
  if (A.size === 0 || B.size === 0) return 0
  let shared = 0
  for (const w of A) if (B.has(w)) shared++
  return shared / (A.size + B.size - shared)
}

// Words too general to identify a symptom on their own ("Pain" must not match "Pelvic pain").
const GENERIC = new Set(['pain', 'ache', 'problem', 'issue', 'symptom', 'discomfort'])

export function matchCatalog(term: string, catalog: CatalogEntry[]): CatalogEntry | undefined {
  const t = tokens(term)
  let best: { entry: CatalogEntry; score: number } | undefined
  for (const entry of catalog) {
    for (const name of [entry.label, entry.clinicalTerm]) {
      if (!name) continue
      const n = tokens(name)
      // A specific term wholly inside an entry's name ("Headache" in "Headache or migraine").
      const contained = t.length > 0 && t.some((w) => !GENERIC.has(w)) && t.every((w) => n.includes(w))
      const score = n.join(' ') === t.join(' ') ? 1 : contained ? 0.9 : similarity(name, term)
      if (score >= 0.6 && (!best || score > best.score)) best = { entry, score }
    }
  }
  return best?.entry
}
