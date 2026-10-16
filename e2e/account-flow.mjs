/**
 * account-flow.mjs — end-to-end check of the real account flow against LOCAL Supabase.
 *
 *   supabase start
 *   npm run dev
 *   node e2e/account-flow.mjs [screenshot-dir]
 *
 * Registers a fresh user, confirms the email through Mailpit, onboards, logs today,
 * edits a past day from the cycle ring, signs out (which wipes the device), signs
 * back in, and checks the entries came back from the server.
 *
 * Never point this at production: it creates accounts.
 */

import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173'
const MAILPIT = process.env.E2E_MAILPIT ?? 'http://127.0.0.1:54324'
const OUT = process.argv[2] ?? null
const email = `e2e-${Date.now()}@test.local`
const password = 'Endo2026check'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const shot = async (page, name) => {
  if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
}

function sql(query) {
  return execFileSync('docker', ['exec', 'supabase_db_medtrace', 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', query], {
    encoding: 'utf8',
  }).trim()
}

async function confirmationLink(to) {
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json()
    const msg = list.messages?.[0]
    if (msg) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()
      const body = full.HTML || full.Text
      const match = body.match(/https?:\/\/[^"'\s<>]+\/auth\/v1\/verify[^"'\s<>]*/)
      if (match) return match[0].replace(/&amp;/g, '&')
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('No confirmation email arrived')
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const errors = []
// After account deletion, supabase-js calls /logout for a user that no longer
// exists; the server answers 403 and the library treats that as success. That
// one response is expected, so it is the only one tolerated — and only once the
// deletion step has started.
let deleting = false
const expectedAfterDeletion = (text) => deleting && /auth\/v1\/logout|status of 403/.test(text)
const record = (text) => { if (!expectedAfterDeletion(text)) errors.push(text) }
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') record(m.text()) })
page.on('response', (r) => { if (r.status() >= 400) record(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace(/\?.*/, '')}`) })

try {
  // --- Register ---------------------------------------------------------
  await page.goto(`${BASE}/#/login`)
  await page.getByRole('heading', { name: 'Welcome back' }).waitFor()
  await shot(page, '01-login')
  check('signed-out user lands on login', true)

  await page.getByRole('link', { name: 'Create an account' }).click()
  await page.getByLabel('Email').fill(email)
  const pw = page.locator('input[autocomplete="new-password"]')
  await pw.nth(0).fill(password)
  await pw.nth(1).fill(password)
  await page.getByRole('checkbox', { name: 'I am 18 or older.' }).check()
  // The notice must be opened before it can be agreed to; its button agrees and closes.
  check('create account disabled until the notice is agreed', await page.getByRole('button', { name: 'Create account' }).isDisabled())
  await page.getByRole('button', { name: 'Read the privacy notice' }).click()
  await page.getByRole('button', { name: 'I have read and agree' }).click()
  await shot(page, '02-register')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByRole('heading', { name: 'Check your email' }).waitFor()
  check('registration asks for email confirmation', true)

  check(
    'sign-up trigger created a profile with the 18+ attestation',
    sql(`select age_confirmed_18 from profiles p join auth.users u on u.id = p.user_id where u.email = '${email}'`) === 't',
  )

  // --- Confirm via Mailpit ------------------------------------------------
  const link = await confirmationLink(email)
  await page.goto(link)
  await page.getByRole('heading', { name: 'Before you start' }).waitFor({ timeout: 15000 })
  check('confirmation link signs in and opens onboarding', true)
  await shot(page, '03-onboarding-consent')

  // --- Onboarding ---------------------------------------------------------
  const cont = page.getByRole('button', { name: 'Continue' })
  check('cannot continue without core consent', await cont.isDisabled())
  await page.getByRole('checkbox', { name: /Keep my symptom record/ }).check()
  await cont.click()
  await page.getByText('I think it might be endometriosis').click()
  await cont.click()
  await shot(page, '04-onboarding-symptoms')
  await cont.click()
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.getByRole('heading', { name: 'Today' }).waitFor()
  check('onboarding completes into Today', true)
  await shot(page, '05-today-empty')

  // --- Log today ---------------------------------------------------------
  await page.getByRole('button', { name: 'Heavy', exact: true }).click()
  await page.getByLabel('Pelvic pain, 0 to 10').fill('6')
  await page.getByRole('button', { name: 'Fatigue' }).click()
  await page.getByRole('button', { name: '+ Add another' }).click()
  await page.getByRole('button', { name: 'Pain passing urine' }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('Saved', { exact: true }).waitFor()
  check('today’s entry saves', true)
  await shot(page, '06-today-saved')

  // --- Fill in a past day from the Calendar --------------------------------
  // 14 days back: far enough to be its own period, so the ring gains a second cycle.
  const todayIso = await page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()))
  const past = new Date(`${todayIso}T00:00:00Z`)
  past.setUTCDate(past.getUTCDate() - 14)
  const pastIso = past.toISOString().slice(0, 10)

  await page.getByRole('link', { name: 'Calendar' }).first().click()
  if (pastIso.slice(0, 7) !== todayIso.slice(0, 7)) {
    await page.getByRole('button', { name: 'Previous month' }).click()
  }
  await page.getByRole('button', { name: new RegExp(`^${pastIso}`) }).click()
  await page.getByText(/no entry yet/).waitFor()
  check('tapping a calendar day opens that day’s log', page.url().includes(`/log/${pastIso}`))
  const pastUrl = page.url()
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('Saved', { exact: true }).waitFor()
  // Let the first version reach the server. Edits made before a sync are merged
  // into one upload by design; the history records every version the server held.
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Moderate', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByText('Saved', { exact: true }).waitFor()
  await shot(page, '07-past-day-edited')

  // Give the outbox a moment to flush.
  await page.waitForTimeout(2500)
  const uid = sql(`select id from auth.users where email = '${email}'`)
  const days = Number(sql(`select count(*) from day_entries where user_id = '${uid}' and deleted_at is null`))
  check('both entries reached the server', days === 2, `${days} rows`)
  const symptoms = sql(`select symptoms::text from day_entries where user_id = '${uid}' order by date desc limit 1`)
  check('the "+ Add another" symptom was saved', symptoms.includes('dysuria'), symptoms)
  check('no invented severity on a chip symptom', symptoms.includes('"fatigue": {"state": "present"}'), symptoms)
  check(
    'editing a day archived the previous version',
    Number(sql(`select count(*) from day_entry_revisions where user_id = '${uid}'`)) >= 1,
  )
  check(
    'consent was recorded against the notice version',
    sql(`select count(*) from consents where user_id = '${uid}' and purpose = 'core_tracking' and granted`) === '1',
  )

  // --- The ring: two periods logged → two cycles; page back and tap the day ----
  await page.getByRole('link', { name: 'Today' }).first().click()
  await page.getByRole('button', { name: 'Previous cycle' }).click()
  await page.getByRole('button', { name: new RegExp(`^Open ${pastIso}`) }).click()
  await page.getByText(/· logged/).waitFor()
  check('paging the ring back and tapping a day opens its log', page.url().includes(`/log/${pastIso}`))
  await shot(page, '07b-ring-tap')

  // --- Other tabs ---------------------------------------------------------
  await page.getByRole('link', { name: 'Calendar' }).first().click()
  await page.getByText(/days logged/).waitFor()
  await shot(page, '08-calendar')

  await page.getByRole('link', { name: 'Insights' }).first().click()
  await page.getByText('Your patterns are still forming').waitFor()
  check('a new user sees evidence progress, not an empty page', true)
  await shot(page, '09-insights')

  await page.getByRole('link', { name: 'Me' }).first().click()
  await page.getByRole('button', { name: '+ Add a treatment' }).click()
  await page.getByPlaceholder('e.g. Dienogest 2 mg').fill('Dienogest 2 mg')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('Dienogest 2 mg').waitFor()
  await shot(page, '10-me')

  // --- Share with a clinician ------------------------------------------------
  await page.getByRole('link', { name: 'Insights' }).first().click()
  await page.getByRole('button', { name: 'Create a share link' }).click()
  await page.getByRole('checkbox', { name: 'Functional impact' }).uncheck()
  await page.getByRole('button', { name: 'Preview' }).click()
  await page.getByText('Preview: exactly what the clinician will see').waitFor()
  await shot(page, '11-share-preview')
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Create link' }).click()
  const linkBox = page.getByLabel('Share link')
  await linkBox.waitFor()
  const shareLink = await linkBox.inputValue()
  check('a share link is created and shown once', shareLink.includes('/#/s/'))
  const accessCode = (await page.getByLabel(/^Access code/).innerText()).trim()
  check('a 6-digit access code is shown with the link', /^\d{6}$/.test(accessCode), accessCode)

  const tokenPart = shareLink.split('/#/s/')[1]
  check(
    'only the hash of the token is stored',
    Number(sql(`select count(*) from share_grants where token_hash = '${tokenPart}'`)) === 0 &&
      Number(sql(`select count(*) from share_grants where user_id = '${uid}'`)) === 1,
  )

  // A clinician, signed out, in a separate browser.
  const clinician = await browser.newContext({ viewport: { width: 1100, height: 900 } })
  const cpage = await clinician.newPage()
  await cpage.goto(shareLink)
  await cpage.getByRole('heading', { name: 'Enter the access code' }).waitFor()
  check('the link alone shows no report', (await cpage.locator('article').count()) === 0)
  await cpage.getByLabel('Access code').fill(accessCode === '000000' ? '111111' : '000000')
  await cpage.getByRole('button', { name: 'Open report' }).click()
  await cpage.getByText('That didn’t work').waitFor()
  check('a wrong code opens nothing', (await cpage.locator('article').count()) === 0)
  await cpage.getByLabel('Access code').fill(accessCode)
  await cpage.getByRole('button', { name: 'Open report' }).click()
  await cpage.getByRole('heading', { name: 'Longitudinal symptom summary' }).waitFor()
  const sharedText = await cpage.locator('article').innerText()
  check('the clinician sees the report without an account', /patient-reported/i.test(sharedText))
  check('an unticked section is not in the shared copy', !/FUNCTIONAL IMPACT/i.test(sharedText))
  if (OUT) await cpage.screenshot({ path: `${OUT}/12-clinician-view.png`, fullPage: true })
  check(
    'the view was logged in the patient’s audit trail',
    Number(sql(`select count(*) from audit_events where user_id = '${uid}' and action = 'share_link_viewed'`)) === 1,
  )

  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Show link & code' }).first().click()
  check(
    'after Done, the same link and code can be shown again',
    (await page.getByLabel('Share link').inputValue()) === shareLink &&
      (await page.getByLabel(/^Access code/).innerText()).trim() === accessCode,
  )
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Revoke' }).first().click()
  await page.waitForTimeout(800)
  await cpage.reload()
  await cpage.getByLabel('Access code').fill(accessCode)
  await cpage.getByRole('button', { name: 'Open report' }).click()
  await cpage.getByText('That didn’t work').waitFor()
  check('a revoked link stops working immediately', true)
  await clinician.close()

  // --- Sign out wipes the device; sign in restores from the server ---------
  await page.getByRole('link', { name: 'Me' }).first().click()
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.getByRole('heading', { name: 'Welcome back' }).waitFor()
  const dbNames = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))
  check('sign-out removes the account’s local database', !dbNames.some((n) => n?.startsWith('medtrace-')), dbNames.join(','))

  await page.getByLabel('Email').fill(email)
  await page.locator('input[autocomplete="current-password"]').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('heading', { name: 'Today' }).waitFor()
  check('returning user skips onboarding', true)
  await page.goto(pastUrl)
  await page.getByText('logged', { exact: false }).first().waitFor()
  const moderateSelected = await page.getByRole('button', { name: 'Moderate', exact: true }).getAttribute('data-selected')
  check('the edited past day came back from the server', moderateSelected === 'true')

  // --- Erasure ------------------------------------------------------------
  await page.getByRole('link', { name: 'Me' }).first().click()
  await page.getByRole('button', { name: 'Delete account…' }).click()
  const erase = page.getByRole('button', { name: 'Permanently delete' })
  check('deletion needs the confirmation word', await erase.isDisabled())
  await page.getByLabel('Type DELETE to confirm').fill('DELETE')
  deleting = true
  await erase.click()
  await page.getByRole('heading', { name: 'Welcome back' }).waitFor()
  const remaining = Number(
    sql(`select (select count(*) from auth.users where id = '${uid}')
          + (select count(*) from day_entries where user_id = '${uid}')
          + (select count(*) from day_entry_revisions where user_id = '${uid}')
          + (select count(*) from consents where user_id = '${uid}')
          + (select count(*) from share_grants where user_id = '${uid}')
          + (select count(*) from audit_events where user_id = '${uid}')`),
  )
  check('deleting the account erases every row', remaining === 0, `${remaining} rows left`)

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (err) {
  check('flow completed', false, String(err))
  await shot(page, 'zz-failure')
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
