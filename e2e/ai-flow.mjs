/**
 * ai-flow.mjs — end-to-end check of the AI features and the impact and background
 * additions, against LOCAL Supabase with MedGemma running in Ollama.
 *
 *   supabase start
 *   ollama pull medgemma:4b
 *   npx supabase functions serve
 *   npm run dev
 *   node e2e/ai-flow.mjs [screenshot-dir]
 *
 * Registers a fresh user with AI help on, loads four months of logs, then:
 * fills today's check-in from a casual note, records a health background, writes
 * the AI summary, and checks what a share link includes. Separate from
 * account-flow.mjs because it needs the model, which takes seconds per call.
 *
 * Never point this at production: it creates accounts.
 */

import { chromium } from 'playwright'
import { execFileSync, execSync } from 'node:child_process'

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173'
const MAILPIT = process.env.E2E_MAILPIT ?? 'http://127.0.0.1:54324'
const OUT = process.argv[2] ?? null
const email = `e2e-ai-${Date.now()}@test.local`
const password = 'Endo2026check'
const NOTE = "Had really bad cramps this morning, around 8 out of 10. Had loose stools and couldn't go to college. Took ibuprofen around ten and felt better by lunch. Period is heavy today."

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const shot = async (page, name) => {
  if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
}
const sql = (query) =>
  execFileSync('docker', ['exec', 'supabase_db_medtrace', 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', query], { encoding: 'utf8' }).trim()

async function confirmationLink(to) {
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json()
    const msg = list.messages?.[0]
    if (msg) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()
      const match = (full.HTML || full.Text).match(/https?:\/\/[^"'\s<>]+\/auth\/v1\/verify[^"'\s<>]*/)
      if (match) return match[0].replace(/&amp;/g, '&')
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('No confirmation email arrived')
}

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

try {
  // --- Register, confirm, onboard with AI help on -------------------------
  await page.goto(`${BASE}/#/login`)
  await page.getByRole('link', { name: 'Create an account' }).click()
  await page.getByLabel('Email').fill(email)
  const pw = page.locator('input[autocomplete="new-password"]')
  await pw.nth(0).fill(password)
  await pw.nth(1).fill(password)
  await page.getByRole('checkbox', { name: 'I am 18 or older.' }).check()
  await page.getByRole('button', { name: 'Read the privacy notice' }).click()
  await page.getByRole('button', { name: 'I have read and agree' }).click()
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByRole('heading', { name: 'Check your email' }).waitFor()
  await page.goto(await confirmationLink(email))
  await page.getByRole('heading', { name: 'Before you start' }).waitFor({ timeout: 15000 })
  await page.getByRole('checkbox', { name: /Keep my symptom record/ }).check()
  await page.getByRole('checkbox', { name: /AI help/ }).check()
  const cont = page.getByRole('button', { name: 'Continue' })
  await cont.click()
  await page.getByText('I think it might be endometriosis').click()
  await cont.click()
  await cont.click()
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await page.getByRole('heading', { name: 'Today' }).waitFor()
  // Consent is saved on the device first and synced moments later.
  let aiConsent = ''
  for (let i = 0; i < 20 && aiConsent !== 't'; i++) {
    aiConsent = sql(`select granted from current_consents c join auth.users u on u.id = c.user_id where u.email = '${email}' and purpose = 'ai_symptom_wording'`)
    if (aiConsent !== 't') await page.waitForTimeout(500)
  }
  check('onboarded with AI help switched on', aiConsent === 't')

  // Four months of history, so the report has patterns and impact areas to show.
  execSync(`npx tsx scripts/seed-my-logs.ts ${email}`, { encoding: 'utf8', stdio: 'ignore' })
  await page.reload()
  await page.getByRole('heading', { name: 'Today' }).waitFor()

  // --- Fill today's check-in from a casual note ------------------------------
  await page.getByRole('tab', { name: 'Quick' }).click()
  await page.getByLabel('How was today? (optional)').fill(NOTE)
  await page.getByRole('button', { name: 'Fill in the form for me' }).click()
  await page.getByText('I understood this:').waitFor({ timeout: 120000 })
  await shot(page, 'ai-01-understood')
  const card = await page.locator('.notice', { hasText: 'I understood this:' }).innerText()
  check('the note is read back before anything changes', /8 out of 10/.test(card) && /Heavy/.test(card), card.replace(/\s+/g, ' ').slice(0, 160))
  await page.getByRole('button', { name: 'Fill it in' }).click()
  await page.getByText('Filled in from your note').waitFor()
  check('impact and medication answers switch the form to Detailed so they are visible',
    (await page.getByRole('tab', { name: 'Detailed' }).getAttribute('aria-selected')) === 'true')
  check('pain filled from the note', (await page.getByLabel('Pelvic pain, 0 to 10').inputValue()) === '8')
  check('the new impact area "Walking / getting around" is offered',
    await page.getByRole('button', { name: 'Walking / getting around' }).isVisible())
  await shot(page, 'ai-02-filled')
  await page.getByRole('button', { name: /^Save/ }).click()
  await page.getByText('Saved', { exact: true }).waitFor()
  await page.waitForTimeout(2500)
  const uid = sql(`select id from auth.users where email = '${email}'`)
  const todayIso = await page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()))
  const row = sql(`select bleeding || '|' || impact || '|' || array_to_string(impact_domains, ',') || '|' || medications::text || '|' || (symptoms ? 'diarrhoea') from day_entries where user_id = '${uid}' and date = '${todayIso}'`)
  check('the saved day holds what she confirmed', /^heavy\|3\|education\|.*Ibuprofen.*\|true$/.test(row), row)

  // --- Health background --------------------------------------------------------
  await page.getByRole('link', { name: 'Me' }).first().click()
  await page.getByRole('button', { name: 'Fill in your background' }).click()
  await page.getByLabel('Heavy periods?').selectOption('yes')
  await page.getByLabel('Days your bleeding usually lasts').fill('6')
  await page.getByLabel('Other health conditions').fill('asthma, migraine')
  await page.getByLabel('Any fertility concerns?').selectOption('yes')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('Saved', { exact: true }).waitFor()
  await shot(page, 'ai-03-background')
  await page.waitForTimeout(2500)
  check('health background reaches the server',
    sql(`select heavy_bleeding || typical_bleeding_days || fertility_concerns || array_to_string(health_conditions, ';') from profiles where user_id = '${uid}'`) === 'yes6yesasthma;migraine')

  // --- The report: background, impact areas, AI summary ------------------------
  await page.getByRole('link', { name: 'Insights' }).first().click()
  const report = page.locator('article').first()
  await report.getByText('Background', { exact: true }).waitFor()
  const reportText = await report.innerText()
  check('the report shows her background, fertility included in her own copy',
    /Heavy periods/.test(reportText) && /Fertility concerns/.test(reportText))
  check('the report names the areas of life symptoms got in the way of', /areas? of life symptoms most often got in the way of/.test(reportText))

  await page.getByRole('button', { name: 'Write a summary with AI' }).click()
  await page.getByText(/sentences reworded/).waitFor({ timeout: 240000 })
  const summaryNote = await page.getByText(/sentences reworded/).innerText()
  check('the AI summary is written and checked', /\d+ of \d+ sentences reworded/.test(summaryNote), summaryNote.slice(0, 120))
  await shot(page, 'ai-04-summary')

  // --- Share: summary in, fertility out by default ------------------------------
  await page.getByRole('button', { name: 'Create a share link' }).click()
  check('fertility is off by default in a share link', !(await page.getByRole('checkbox', { name: /Fertility and pregnancy/ }).isChecked()))
  await page.getByRole('button', { name: 'Preview' }).click()
  const preview = await page.locator('[aria-label="Preview of shared report"] article').innerText()
  check('the shared copy includes the checked summary and menstrual history', /Summary in plain words/i.test(preview) && /Heavy periods/.test(preview))
  check('the shared copy leaves fertility answers out', !/Fertility concerns/.test(preview))
  await shot(page, 'ai-05-share-preview')
  await page.getByRole('button', { name: 'Close' }).click()

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  check('flow completed', false, e.message.split('\n')[0])
  await shot(page, 'ai-99-failure')
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
