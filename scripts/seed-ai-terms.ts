/**
 * seed-ai-terms.ts — run real symptom descriptions through the medical-term
 * suggestion (MedGemma, via the interpret-symptom edge function) for an account
 * on the LOCAL Supabase, and keep what it suggests, as a patient tapping
 * "Keep this" would.
 *
 *   npx tsx scripts/seed-ai-terms.ts you@example.com
 *
 * Nothing here is hard-coded: every term printed and saved is MedGemma's own
 * answer, after the same server-side validation the app relies on. Unlike a
 * patient, this script accepts every suggestion, so read what it prints. It signs in
 * as the account (a one-time login link issued locally), so consent and row-level
 * security apply exactly as they do in the app. The account must have
 * "Suggest medical terms" switched on.
 *
 * The new symptoms are added to the account's existing logged days: present on
 * most bad-mood days around the period, absent on the other logged days.
 */

import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { customSymptomKey } from '../src/data/mappers'
import { SYMPTOMS } from '../src/engine/symptoms'

const email = process.argv[2]?.trim().toLowerCase()
if (!email) {
  console.error('Usage: npx tsx scripts/seed-ai-terms.ts you@example.com')
  process.exit(1)
}

// What the patient typed. Short, in her own words, as the input box allows.
const DESCRIPTIONS = [
  'mood swings',
  'crying for no reason before my period',
  'snapping at everyone, so irritable',
  "can't focus on anything",
  'craving sweets all the time',
  'sore boobs',
]

// ---- Local Supabase only -------------------------------------------------------
const env = Object.fromEntries(
  execSync('npx supabase status -o env', { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.match(/^([A-Z_0-9]+)="(.*)"$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => [m[1], m[2]]),
)
const url = env.API_URL
if (!url || !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error(`Refusing to run: ${url ?? 'no API URL'} is not a local Supabase.`)
  process.exit(1)
}
const admin = createClient(url, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const patient = createClient(url, env.ANON_KEY, { auth: { persistSession: false } })

// ---- Sign in as the account ----------------------------------------------------
const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
if (linkError) throw linkError
const { error: otpError } = await patient.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token })
if (otpError) throw otpError

const { data: consent } = await patient
  .from('current_consents').select('granted').eq('purpose', 'ai_symptom_wording').maybeSingle()
if (!consent?.granted) {
  console.error('Turn on "Suggest medical terms" in the app (Me → Your data) first.')
  process.exit(1)
}

const { data: profile } = await patient.from('profiles').select('*').single()
const { data: customRows } = await patient.from('custom_symptoms').select('*').is('deleted_at', null)

// The catalog the check-in form sends: everything the patient could pick.
const catalogFor = (exclude?: string) => [
  ...SYMPTOMS
    .filter((s) => s.id !== 'pelvic_pain' && (!s.sensitive || profile.enabled_domains.includes('sexual')))
    .map((s) => ({ id: s.id, label: s.label, clinicalTerm: s.clinicalTerm })),
  ...(customRows ?? []).filter((r) => r.symptom_key !== exclude)
    .map((r) => ({ id: r.symptom_key, label: r.label, clinicalTerm: r.clinical_term ?? undefined })),
]

// ---- Ask MedGemma ----------------------------------------------------------------
console.log('Asking MedGemma (about 9 seconds each)…\n')
const added: { key: string; graded: boolean }[] = []
const now = new Date().toISOString()

for (const text of DESCRIPTIONS) {
  const key = customSymptomKey(text)
  const existing = (customRows ?? []).find((r) => r.label.toLowerCase() === text.toLowerCase())
  if (existing?.clinical_term) {
    // Already confirmed: a patient isn't asked again, and a second answer must not replace it.
    console.log(`  "${text}" → already confirmed as ${existing.clinical_term}`)
    continue
  }
  const { data, error } = await patient.functions.invoke('interpret-symptom', {
    body: { text, catalog: catalogFor(existing?.symptom_key) },
  })
  if (error) {
    console.log(`  "${text}" → function error (${error.message})`)
    continue
  }
  console.log(`  "${text}" → ${JSON.stringify(data)}`)

  if (data.match === 'new') {
    if (existing) {
      // An earlier symptom in her words: keep the suggested term, as "Keep this" would.
      const { error: e } = await patient.from('custom_symptoms')
        .update({ clinical_term: data.clinicalTerm, domain: data.domain, client_updated_at: now })
        .eq('symptom_key', existing.symptom_key)
      if (e) throw e
    } else {
      const { error: e } = await patient.from('custom_symptoms').upsert(
        { symptom_key: key, label: text, domain: data.domain, graded: data.graded, clinical_term: data.clinicalTerm, client_updated_at: now },
        { onConflict: 'user_id,symptom_key' },
      )
      if (e) throw e
      added.push({ key, graded: data.graded })
    }
  } else if (data.match === 'catalog' && !existing) {
    added.push({ key: data.catalogId, graded: data.graded })
  }
}

// ---- Add the new symptoms to her logged days ------------------------------------------
// Deterministic: the same account and dates always give the same days.
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7) / 2 ** 32

const { data: days, error: dayError } = await patient.from('day_entries').select('*').is('deleted_at', null)
if (dayError) throw dayError
let changed = 0
for (const day of days ?? []) {
  const badMood = day.symptoms.low_mood?.state === 'present' || day.symptoms.custom_mood_swings?.state === 'present'
  const symptoms = { ...day.symptoms }
  let touched = false
  for (const { key, graded } of added) {
    if (symptoms[key]) continue // never overwrite something already logged
    const present = badMood && hash(`${day.date}:${key}`) < 0.6
    symptoms[key] = present
      ? graded ? { state: 'present', severity: 5 + Math.floor(hash(`${key}:${day.date}`) * 4) } : { state: 'present' }
      : { state: 'absent' }
    touched = true
  }
  if (!touched) continue
  const { error: e } = await patient.from('day_entries')
    .update({ symptoms, client_updated_at: now }).eq('id', day.id)
  if (e) throw e
  changed++
}

await patient.from('profiles').update({
  tracked_symptom_ids: [...new Set([...(profile.tracked_symptom_ids ?? []), ...added.map((a) => a.key)])],
}).eq('user_id', profile.user_id)

await patient.auth.signOut({ scope: 'local' })
console.log(`\nAdded ${added.length} symptoms to ${changed} logged days for ${email}.`)
console.log('Open the app (or switch back to it) and it will sync. See Insights → Report.')
