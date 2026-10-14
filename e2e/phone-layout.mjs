/**
 * phone-layout.mjs — every tab at phone width, in the demo (no account needed).
 *
 *   npm run dev
 *   node e2e/phone-layout.mjs [screenshot-dir]
 *
 * Checks the bottom tab bar is used, nothing scrolls sideways, and no errors fire,
 * in both light and dark themes.
 */

import { chromium } from 'playwright'

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173'
const OUT = process.argv[2] ?? null
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const browser = await chromium.launch()
for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: theme })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(`${BASE}/#/login`)
  await page.getByRole('button', { name: /^Maya/ }).click()
  await page.getByRole('heading', { name: 'Today' }).waitFor()

  const tabbar = page.locator('nav.tabbar')
  check(`[${theme}] bottom tab bar is visible`, await tabbar.isVisible())

  for (const [tab, ready] of [
    ['Today', 'Today'],
    ['Calendar', null],
    ['Insights', 'Insights'],
    ['Me', 'Me'],
  ]) {
    await tabbar.getByRole('link', { name: tab }).click()
    if (ready) await page.getByRole('heading', { name: ready, exact: true }).first().waitFor()
    await page.waitForTimeout(300)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(`[${theme}] ${tab}: no horizontal scroll`, overflow <= 1, `${overflow}px`)
    if (OUT) await page.screenshot({ path: `${OUT}/phone-${theme}-${tab.toLowerCase()}.png`, fullPage: false })
  }

  // Insights segments render at phone width too.
  await tabbar.getByRole('link', { name: 'Insights' }).click()
  for (const seg of ['Patterns', 'Timeline', 'How it works']) {
    await page.getByRole('tab', { name: seg }).click()
    await page.waitForTimeout(300)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(`[${theme}] Insights → ${seg}: no horizontal scroll`, overflow <= 1, `${overflow}px`)
  }

  check(`[${theme}] no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
}
await browser.close()

const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
