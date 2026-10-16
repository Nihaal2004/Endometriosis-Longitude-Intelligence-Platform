/**
 * seed-my-logs.ts — load Veditha's back-filled logs into her account.
 *
 *   npx tsx scripts/seed-my-logs.ts you@example.com           # local Supabase
 *   npx tsx scripts/seed-my-logs.ts you@example.com --cloud   # the project in .env.android.local
 *
 * Sign up and finish onboarding in the app first: consent is the patient's own
 * act and is never written here. The script only adds what the check-in form
 * would have: day entries, the "Mood swings" symptom, and the tracked-symptom
 * list. Days that already hold an entry are left alone, so it is safe to re-run.
 *
 * Local: uses the service-role key, which bypasses row-level security, so it
 * refuses anything but a local Supabase.
 * Cloud: signs in AS the account holder with the public anon key and her own
 * password (asked for, never stored), so row-level security limits every write
 * to her own rows, exactly as if the app had made them.
 */

import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { generatePatient, type GeneratorConfig } from '../src/data/generator'
import { dayToRow } from '../src/data/mappers'
import { ImpactLevel } from '../src/engine/types'

const email = process.argv[2]?.trim().toLowerCase()
const cloud = process.argv.includes('--cloud')
if (!email || email.startsWith('--')) {
  console.error('Usage: npx tsx scripts/seed-my-logs.ts you@example.com [--cloud]')
  process.exit(1)
}

// ---- Connect -------------------------------------------------------------------
async function connectLocal(): Promise<{ db: SupabaseClient; userId: string }> {
  const env = Object.fromEntries(
    execSync('npx supabase status -o env', { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.match(/^([A-Z_0-9]+)="(.*)"$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1], m[2]]),
  )
  const url = env.API_URL
  if (!url || !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    console.error(`Refusing to seed: ${url ?? 'no API URL'} is not a local Supabase.`)
    process.exit(1)
  }
  const admin = createClient(url, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (listError) throw listError
  const user = list.users.find((u) => u.email?.toLowerCase() === email)
  if (!user) {
    console.error(`No account for ${email}. Sign up in the app first.`)
    process.exit(1)
  }
  if (!user.email_confirmed_at) {
    console.error(`${email} is not confirmed yet. Click the link in Mailpit (http://127.0.0.1:54324) first.`)
    process.exit(1)
  }
  return { db: admin, userId: user.id }
}

async function connectCloud(): Promise<{ db: SupabaseClient; userId: string }> {
  const env = Object.fromEntries(
    readFileSync('.env.android.local', 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z_0-9]+)=(.*)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1], m[2].trim()]),
  )
  const url = env.VITE_SUPABASE_URL
  if (!url?.startsWith('https://')) {
    console.error(`.env.android.local points at ${url ?? 'nothing'}, not a cloud project.`)
    process.exit(1)
  }
  let password = process.env.MEDTRACE_PASSWORD
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    password = await rl.question(`Password for ${email} (MedTrace account): `)
    rl.close()
  }
  const db = createClient(url, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await db.auth.signInWithPassword({ email: email!, password })
  if (error) {
    console.error(`Could not sign in to ${url}: ${error.message}`)
    process.exit(1)
  }
  return { db, userId: data.user.id }
}

const { db: admin, userId } = cloud ? await connectCloud() : await connectLocal()

// ---- The record ----------------------------------------------------------------
// Regular cycles, mild cramps; severe low mood and mood swings the week before and
// during each period, some low mood the rest of the month, occasional tiredness.
// About four cycles: the evidence gate needs two complete cycles before it reports.
const config: GeneratorConfig = {
  patientId: 'veditha',
  displayName: 'Veditha',
  seed: 'logs:veditha:v1',
  days: 120,
  endDate: '2026-10-15',
  meanCycleLength: 28,
  cycleLengthSd: 1.5,
  meanBleedDays: 5,
  missingness: { mode: 'mcar', rate: 0.08 },
  // mu in radians, 0 = day one of the period.
  symptoms: [
    { id: 'low_mood', cyclical: true, kappa: 1.6, mu: -0.3, baseRate: 0.12, amplitude: 0.8, severityMean: 8, askProbability: 0.97 },
    { id: 'custom_mood_swings', cyclical: true, kappa: 1.6, mu: -0.3, baseRate: 0.03, amplitude: 0.8, severityMean: 7, askProbability: 0.95 },
    { id: 'menstrual_pain', cyclical: true, kappa: 8, mu: 0.15, baseRate: 0, amplitude: 0.55, severityMean: 2, askProbability: 0.95 },
    { id: 'fatigue', cyclical: false, kappa: 0, mu: 0, baseRate: 0.15, amplitude: 0.05, severityMean: 4, askProbability: 0.85 },
  ],
}
const TRACKED = config.symptoms.map((s) => s.id)

const days = generatePatient(config).days
  .filter((d) => d.logged !== false)
  .map((d) => ({
    ...d,
    // Painkillers only on days with cramps; a bad-mood day costs mood and social life.
    medications: d.symptoms.menstrual_pain?.state === 'present' ? d.medications : undefined,
    impactDomains: d.impact != null && d.impact >= ImpactLevel.ModifiedActivities ? ['mood', 'social'] : d.impactDomains,
  }))

// ---- Check the account ------------------------------------------------------------
const user = { id: userId }
const { data: profile } = await admin.from('profiles').select('*').eq('user_id', user.id).maybeSingle()
if (!profile?.onboarded_at) {
  console.error('Finish onboarding in the app first (it records your consent), then re-run this.')
  process.exit(1)
}

// ---- Write -------------------------------------------------------------------------
const now = new Date().toISOString()

const { error: symptomError } = await admin.from('custom_symptoms').upsert(
  { user_id: user.id, symptom_key: 'custom_mood_swings', label: 'Mood swings', domain: 'systemic', graded: true, client_updated_at: now },
  { onConflict: 'user_id,symptom_key', ignoreDuplicates: true },
)
if (symptomError) throw symptomError

const rows = days.map((d) => ({ ...dayToRow(d, randomUUID(), now), user_id: user.id }))
const { data: inserted, error: dayError } = await admin
  .from('day_entries')
  .upsert(rows, { onConflict: 'user_id,date', ignoreDuplicates: true })
  .select('date')
if (dayError) throw dayError

const { error: profileError } = await admin
  .from('profiles')
  .update({
    tracked_symptom_ids: [...new Set([...(profile.tracked_symptom_ids ?? []), ...TRACKED])],
    enabled_domains: [...new Set([...(profile.enabled_domains ?? []), 'pain', 'systemic'])],
    age_range: profile.age_range ?? '22',
  })
  .eq('user_id', user.id)
if (profileError) throw profileError

console.log(`Added ${inserted?.length ?? 0} days (${days[0].date} → ${days[days.length - 1].date}) to ${email}.`)
console.log(`${rows.length - (inserted?.length ?? 0)} days already had an entry and were left alone.`)
console.log('Open the app (or switch back to its tab) and it will sync them in.')
