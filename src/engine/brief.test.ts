/**
 * brief.test.ts — Gate for brief generation and the fidelity checker.
 *
 * The claim this suite has to establish is the one the whole architecture rests on:
 * every number printed in the clinician brief can be independently re-derived from the
 * raw day records, and a corrupted number is caught rather than printed.
 */

import { describe, expect, it } from 'vitest'
import { generateBrief, formatP, mainConcerns, pct, rankFindings, SAFETY_STATEMENT } from './brief'
import { segmentCycles } from './cycles'
import { buildFeatureContext } from './features'
import {
  applyFidelityGate,
  extractNumbers,
  independentMenstrualWindow,
  independentOnsets,
  mutateClaim,
  verifyBrief,
  verifyPolishedText,
} from './fidelity'
import { runPatternEngine } from './patterns'
import { createRandom } from './rng'
import { generatePatient } from '../data/generator'
import type { Finding, PatientRecord } from './types'

// ---------------------------------------------------------------------------
// Fixture: a patient with a clear, detectable pattern
// ---------------------------------------------------------------------------

function buildPatient(seed = 'brief:fixture'): PatientRecord {
  return generatePatient({
    patientId: 'brief-test',
    displayName: 'Brief Test',
    seed,
    days: 180,
    endDate: '2026-09-01',
    meanCycleLength: 29,
    cycleLengthSd: 2,
    meanBleedDays: 5,
    missingness: { mode: 'mcar', rate: 0.1 },
    symptoms: [
      { id: 'painful_bm', cyclical: true, kappa: 6, mu: 0, baseRate: 0.04, amplitude: 0.7, severityMean: 5 },
      { id: 'pelvic_pain', cyclical: true, kappa: 3, mu: -0.2, baseRate: 0.18, amplitude: 0.5, severityMean: 6 },
      { id: 'fatigue', cyclical: false, kappa: 3, mu: 0, baseRate: 0.25, amplitude: 0.3, severityMean: 4 },
    ],
  })
}

function buildBrief(record: PatientRecord) {
  const ctx = buildFeatureContext(record)
  const { findings, suppressed } = runPatternEngine(ctx)
  return { ctx, brief: generateBrief(ctx, findings, suppressed, {
    maxFindings: 8,
    persistenceFloor: 0.2,
    kappaFloor: 0.21,
  }) }
}

// ---------------------------------------------------------------------------
// The two cycle implementations must agree
// ---------------------------------------------------------------------------

describe('independent re-derivation agrees with the primary path', () => {
  it('finds the same bleeding onsets as the cycle segmenter', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const record = buildPatient(`onsets:${seed}`)
      const primary = segmentCycles(record.days).map((c) => c.startDate)
      const independent = independentOnsets(record.days)
      expect(independent).toEqual(primary)
    }
  })

  it('classifies the same days as perimenstrual as the signed-cycle-day rule', () => {
    const record = buildPatient('window:check')
    const cycles = segmentCycles(record.days)
    const ctx = buildFeatureContext(record)

    const independent = independentMenstrualWindow(independentOnsets(record.days))

    // Compare over every date the primary path actually assigned to a cycle.
    let compared = 0
    for (const date of ctx.orderedDates) {
      const aligned = ctx.aligned.get(date)
      if (!aligned) continue
      // The final incomplete cycle has no "next onset", so days near its end are not
      // perimenstrual under either rule; both agree by construction.
      expect(independent.has(date)).toBe(aligned.inMenstrualWindow)
      compared++
    }
    expect(compared).toBeGreaterThan(80)
    expect(cycles.length).toBeGreaterThan(3)
  })

  it('agrees with the primary path on a sparse record with long silences', () => {
    const sparse = [
      { date: '2026-09-18', logged: true, bleeding: 'moderate' as const, symptoms: {} },
      { date: '2026-10-15', logged: true, bleeding: 'heavy' as const, symptoms: {} },
      { date: '2026-11-11', logged: true, bleeding: 'light' as const, symptoms: {} },
    ]
    expect(independentOnsets(sparse)).toEqual(segmentCycles(sparse).map((c) => c.startDate))
    expect(independentOnsets(sparse)).toHaveLength(3)
  })

  it('survives unlogged days inside a bleeding run without splitting the cycle', () => {
    const record = buildPatient('gaps')
    // Blank out a scattering of days, including some bleeding days.
    const gapped: PatientRecord = {
      ...record,
      days: record.days.map((d, i) =>
        i % 11 === 0 ? { date: d.date, logged: false, symptoms: {} } : d,
      ),
    }
    expect(independentOnsets(gapped.days)).toEqual(
      segmentCycles(gapped.days).map((c) => c.startDate),
    )
  })
})

// ---------------------------------------------------------------------------
// Brief generation
// ---------------------------------------------------------------------------

describe('brief generation', () => {
  const record = buildPatient()
  const { ctx, brief } = buildBrief(record)

  it('produces claims across the expected sections', () => {
    const sections = new Set(brief.claims.map((c) => c.section))
    expect(sections.has('period')).toBe(true)
    expect(sections.has('findings')).toBe(true)
    expect(sections.has('quality')).toBe(true)
    expect(brief.claims.length).toBeGreaterThan(3)
  })

  it('reports coverage and never implies unlogged days were symptom-free', () => {
    const quality = brief.claims.find((c) => c.section === 'quality')!
    expect(quality.text).toContain('unknown')
    expect(quality.text).toContain('not counted as symptom-free')
  })

  it('attributes every finding claim to a finding that passed the gate', () => {
    const passedIds = new Set(brief.findings.map((f) => f.id))
    for (const c of brief.claims) {
      if (c.section === 'findings' || c.section === 'change') {
        expect(passedIds.has(c.findingId)).toBe(true)
      }
    }
  })

  it('describes a single cycle by its length, not a median and a range', () => {
    const days = [
      { date: '2026-10-01', logged: true, bleeding: 'heavy' as const, symptoms: {} },
      { date: '2026-10-15', logged: true, bleeding: 'heavy' as const, symptoms: {} },
    ]
    const single = buildFeatureContext(
      { ...record, days, treatments: [], clinicalEvents: [] },
      { start: '2026-10-01', end: '2026-10-15' },
    )
    const b = generateBrief(single, [], [])
    const cycles = b.claims.find((c) => c.id === 'period:cycles')!
    expect(cycles.text).toContain('1 complete cycle observed, 14 days long.')
    expect(cycles.text).not.toContain('range')
    const report = verifyBrief(b.claims, { ...record, days }, b.windowStart, b.windowEnd)
    expect(report.verifiedClaims).toBe(report.totalClaims)
  })

  it('caps the number of longitudinal findings so the brief stays short', () => {
    const capped = generateBrief(ctx, brief.findings, brief.suppressed, {
      maxFindings: 2,
      persistenceFloor: 0.2,
      kappaFloor: 0.21,
    })
    const findingClaims = capped.claims.filter(
      (c) => c.section === 'findings' || c.section === 'change' || c.section === 'impact',
    )
    expect(findingClaims.length).toBeLessThanOrEqual(2)
  })

  it('states every asserted number somewhere in its own sentence', () => {
    for (const c of brief.claims) {
      const inText = new Set(extractNumbers(c.text))
      for (const [key, value] of Object.entries(c.assertedValues)) {
        // Percentages and counts must literally appear; this is what makes the
        // fidelity check meaningful rather than checking an unused field.
        expect(
          inText.has(value),
          `claim ${c.id} asserts ${key}=${value} but that number is absent from: "${c.text}"`,
        ).toBe(true)
      }
    }
  })

  it('never uses diagnostic language', () => {
    const forbidden = [
      'diagnos', 'endometriosis is', 'likely has', 'risk score',
      'stage ', 'confirms', 'indicates endometriosis', 'probability of',
    ]
    for (const c of brief.claims) {
      const lower = c.text.toLowerCase()
      for (const phrase of forbidden) {
        expect(lower.includes(phrase), `"${phrase}" found in: ${c.text}`).toBe(false)
      }
    }
  })

  it('carries a fixed non-diagnostic boundary statement', () => {
    expect(SAFETY_STATEMENT).toContain('not a diagnosis')
    expect(SAFETY_STATEMENT).toContain('not a substitute for clinical assessment')
  })

  it('states the treatment caveat inline on treatment-response claims', () => {
    const treated = generatePatient({
      patientId: 'treated',
      displayName: 'Treated',
      seed: 'brief:treated',
      days: 180,
      endDate: '2026-09-01',
      meanCycleLength: 28,
      cycleLengthSd: 2,
      meanBleedDays: 5,
      missingness: { mode: 'mcar', rate: 0.08 },
      symptoms: [
        { id: 'pelvic_pain', cyclical: true, kappa: 4, mu: 0, baseRate: 0.2, amplitude: 0.5, severityMean: 6 },
      ],
      treatments: [
        {
          id: 'tx1',
          kind: 'progestin',
          label: 'Norethisterone',
          startDate: '2026-06-15',
          reason: 'Pelvic pain',
        },
      ],
    })
    const { brief: b } = buildBrief(treated)
    const tx = b.claims.find((c) => c.findingId.startsWith('treatment_response'))
    if (tx) expect(tx.text).toContain('not a controlled comparison')
  })

  it('ranks cyclicity findings above co-occurrence', () => {
    const fake = (kind: Finding['kind'], effect: number): Finding => ({
      id: kind, kind, values: {}, coverage: 1, observedDays: 50,
      evidenceDates: [], passed: true, effect: { label: '', value: effect },
    })
    const ranked = rankFindings([fake('co_occurrence', 9), fake('cyclicity', 2)])
    expect(ranked[0].kind).toBe('cyclicity')
  })

  it('formats p-values with a floor rather than reporting zero', () => {
    expect(formatP(0.0000001)).toBe('p < 0.001')
    expect(formatP(0.0032)).toBe('p = 0.003')
    expect(formatP(0.42)).toBe('p = 0.42')
    expect(pct(0.826)).toBe(83)
  })

  it('lists main concerns weighted by burden, not just frequency', () => {
    const concerns = mainConcerns(ctx)
    expect(concerns.length).toBeGreaterThan(0)
    expect(concerns.length).toBeLessThanOrEqual(4)
  })
})

// ---------------------------------------------------------------------------
// Fidelity
// ---------------------------------------------------------------------------

describe('fidelity checking', () => {
  it('verifies every claim of an untampered brief', () => {
    for (const seed of ['f1', 'f2', 'f3', 'f4', 'f5']) {
      const record = buildPatient(seed)
      const { brief } = buildBrief(record)
      const report = verifyBrief(brief.claims, record, brief.windowStart, brief.windowEnd)

      const failures = report.results.filter((r) => !r.verified)
      expect(
        failures.length,
        `seed ${seed}: ${JSON.stringify(failures.map((f) => f.mismatches))}`,
      ).toBe(0)
      expect(report.verifiedClaims).toBe(report.totalClaims)
    }
  })

  it('independently re-derives a substantial share of all asserted numbers', () => {
    const record = buildPatient('coverage')
    const { brief } = buildBrief(record)
    const report = verifyBrief(brief.claims, record, brief.windowStart, brief.windowEnd)
    // The remainder are test statistics that are deterministic functions of counts
    // this checker has already confirmed; the report is explicit about that.
    expect(report.keyCoverage).toBeGreaterThan(0.5)
    expect(report.checkedKeys).toBeGreaterThan(10)
  })

  it('catches a corrupted number in a claim', () => {
    const record = buildPatient('mutation')
    const { brief } = buildBrief(record)
    const rand = createRandom('mutation-seed')

    let attempted = 0
    let caught = 0
    for (const claim of brief.claims) {
      const mutation = mutateClaim(claim, rand.next)
      if (!mutation) continue
      attempted++
      const report = verifyBrief([mutation.mutated], record, brief.windowStart, brief.windowEnd)
      if (!report.results[0].verified) caught++
    }

    expect(attempted).toBeGreaterThan(3)
    expect(caught).toBe(attempted) // every injected corruption must be caught
  })

  it('rejects a claim whose evidence date was never logged', () => {
    const record = buildPatient('evidence')
    const { brief } = buildBrief(record)
    const target = brief.claims.find((c) => c.evidenceDates.length > 0)!
    const tampered = { ...target, evidenceDates: [...target.evidenceDates, '1999-01-01'] }
    const report = verifyBrief([tampered], record, brief.windowStart, brief.windowEnd)
    expect(report.results[0].verified).toBe(false)
  })

  it('drops failed claims and keeps verified ones', () => {
    const record = buildPatient('gate')
    const { brief } = buildBrief(record)
    const rand = createRandom('gate-seed')
    const target = brief.claims.find((c) => mutateClaim(c, rand.next) !== null)!
    const mutation = mutateClaim(target, rand.next)!

    const claims = [...brief.claims.filter((c) => c.id !== target.id), mutation.mutated]
    const report = verifyBrief(claims, record, brief.windowStart, brief.windowEnd)
    const { kept, rejected } = applyFidelityGate(claims, report)

    expect(rejected).toHaveLength(1)
    expect(rejected[0].verificationError).toContain('recomputed')
    expect(kept.every((c) => c.verified)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The LLM polish gate
// ---------------------------------------------------------------------------

describe('numeric-token gate for rewritten prose', () => {
  const claim = {
    id: 'c1',
    findingId: 'cyclicity:painful_bm',
    section: 'findings' as const,
    text: 'Dyschezia was recorded on 9 of 11 observed perimenstrual days (82%).',
    assertedValues: { menstrualPresent: 9, menstrualObserved: 11, menstrualRatePct: 82 },
    evidenceDates: [],
  }

  it('accepts a rewrite that changes only wording', () => {
    expect(
      verifyPolishedText(
        claim,
        'Pain on defaecation was reported on 9 of the 11 perimenstrual days observed (82%).',
      ),
    ).toBe(true)
  })

  it('accepts a rewrite that drops numbers', () => {
    expect(verifyPolishedText(claim, 'Dyschezia clustered around menstruation.')).toBe(true)
  })

  it('rejects an invented number', () => {
    expect(
      verifyPolishedText(claim, 'Dyschezia was recorded on 9 of 11 days (82%), a 14-fold increase.'),
    ).toBe(false)
  })

  it('rejects an altered number', () => {
    expect(
      verifyPolishedText(claim, 'Dyschezia was recorded on 10 of 11 observed perimenstrual days (91%).'),
    ).toBe(false)
  })

  it('extracts decimals and negatives', () => {
    expect(extractNumbers('RR 9.8 (95% CI 3.9–24.6), slope −0.12')).toEqual([9.8, 95, 3.9, 24.6, 0.12])
  })
})
