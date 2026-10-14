/**
 * engine.test.ts — Correctness gate for the cycle, feature and pattern layers.
 *
 * These tests assert the behavioural guarantees the clinician brief depends on. The
 * most important of them is the missing-data invariant: adding unlogged days to a
 * record must not change a single computed rate. If that ever breaks, every number in
 * every brief becomes untrustworthy, so it is tested directly rather than assumed.
 */

import { describe, expect, it } from 'vitest'
import {
  addDays,
  alignToCycles,
  dateRange,
  daysBetween,
  DEFAULT_CYCLE_CONFIG,
  segmentCycles,
  summariseCycles,
} from './cycles'
import {
  buildFeatureContext,
  computeSymptomFeatures,
  defaultWindow,
  pairedObservations,
  presentDates,
} from './features'
import { detectCyclicity, DEFAULT_GATE, runPatternEngine } from './patterns'
import { detectBaselineChange } from './baseline'
import type { DayRecord, PatientRecord, SymptomObservation } from './types'
import { generatePatient, meanVonMisesDensity, occurrenceProbability } from '../data/generator'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function day(
  date: string,
  opts: Partial<DayRecord> & { symptoms?: Record<string, SymptomObservation> } = {},
): DayRecord {
  return { date, logged: true, symptoms: {}, ...opts }
}

/** A record with 28-day cycles and 5 bleed days, starting on the given date. */
function buildRegularRecord(start: string, cycles: number, cycleLength = 28): PatientRecord {
  const days: DayRecord[] = []
  for (let c = 0; c < cycles; c++) {
    for (let d = 0; d < cycleLength; d++) {
      const date = addDays(start, c * cycleLength + d)
      days.push(
        day(date, {
          bleeding: d < 5 ? (d < 2 ? 'heavy' : 'moderate') : 'none',
          symptoms: {},
        }),
      )
    }
  }
  return {
    profile: {
      id: 'test',
      displayName: 'Test',
      diagnosisStatus: 'suspected',
      enabledDomains: ['pain'],
    },
    days,
    treatments: [],
    clinicalEvents: [],
    trackedSymptomIds: [],
  }
}

// ---------------------------------------------------------------------------
// Date arithmetic
// ---------------------------------------------------------------------------

describe('date helpers', () => {
  it('adds and differences days without timezone drift', () => {
    expect(addDays('2026-01-01', 31)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364)
    expect(daysBetween('2026-05-10', '2026-05-10')).toBe(0)
  })

  it('handles a leap year correctly', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366)
  })

  it('builds inclusive date ranges', () => {
    expect(dateRange('2026-01-01', '2026-01-05')).toHaveLength(5)
    expect(dateRange('2026-01-01', '2026-01-01')).toEqual(['2026-01-01'])
  })
})

// ---------------------------------------------------------------------------
// Cycle segmentation
// ---------------------------------------------------------------------------

describe('cycle segmentation', () => {
  it('finds one cycle per bleeding onset', () => {
    const record = buildRegularRecord('2026-01-01', 4)
    const cycles = segmentCycles(record.days)
    expect(cycles).toHaveLength(4)
    expect(cycles[0].startDate).toBe('2026-01-01')
    expect(cycles[1].startDate).toBe('2026-01-29')
    expect(cycles[0].lengthDays).toBe(28)
    expect(cycles[0].bleedDays).toBe(5)
  })

  it('marks only the trailing cycle incomplete', () => {
    const cycles = segmentCycles(buildRegularRecord('2026-01-01', 3).days)
    expect(cycles.slice(0, -1).every((c) => c.complete)).toBe(true)
    expect(cycles[cycles.length - 1].complete).toBe(false)
  })

  it('does not open a new cycle on spotting', () => {
    const days = [
      day('2026-01-01', { bleeding: 'heavy' }),
      day('2026-01-02', { bleeding: 'moderate' }),
      day('2026-01-03', { bleeding: 'none' }),
      day('2026-01-15', { bleeding: 'spotting' }), // mid-cycle spotting
      day('2026-01-16', { bleeding: 'none' }),
      day('2026-01-29', { bleeding: 'heavy' }),
    ]
    const cycles = segmentCycles(days)
    expect(cycles).toHaveLength(2)
    expect(cycles[1].startDate).toBe('2026-01-29')
  })

  it('merges a flow run that resumes within the minimum cycle gap', () => {
    // Bleeding stops for a day then restarts on day 4 — one period, not two.
    const days = [
      day('2026-01-01', { bleeding: 'heavy' }),
      day('2026-01-02', { bleeding: 'moderate' }),
      day('2026-01-03', { bleeding: 'none' }),
      day('2026-01-04', { bleeding: 'light' }),
      day('2026-01-05', { bleeding: 'none' }),
    ]
    expect(segmentCycles(days)).toHaveLength(1)
  })

  it('splits periods separated by a long run of unlogged days (sparse loggers)', () => {
    // Found by the first real end-to-end run: a patient logs bleeding on two days
    // 27 days apart and nothing in between. That is two periods, not one 27-day
    // bleeding run bridged across unknown days.
    const days = [
      day('2026-09-18', { bleeding: 'moderate' }),
      day('2026-10-15', { bleeding: 'heavy' }),
    ]
    const cycles = segmentCycles(days)
    expect(cycles.map((c) => c.startDate)).toEqual(['2026-09-18', '2026-10-15'])
    expect(cycles[0].complete).toBe(true)
    expect(cycles[0].lengthDays).toBe(27)
  })

  it('still bridges a day or two of missing entries inside one period', () => {
    const days = [
      day('2026-09-01', { bleeding: 'heavy' }),
      // 09-02 and 09-03 not logged
      day('2026-09-04', { bleeding: 'moderate' }),
      day('2026-09-05', { bleeding: 'light' }),
    ]
    expect(segmentCycles(days)).toHaveLength(1)
  })

  it('does not invent a short cycle when a gap splits a period', () => {
    // Four unlogged days mid-period split the run, but the second half is within
    // the 10-day minimum, so it is not a new onset.
    const days = [
      day('2026-09-01', { bleeding: 'heavy' }),
      day('2026-09-06', { bleeding: 'light' }),
    ]
    expect(segmentCycles(days)).toHaveLength(1)
  })

  it('does not assume a 28-day cycle', () => {
    const days: DayRecord[] = []
    const lengths = [24, 33, 26, 31]
    let cursor = '2026-01-01'
    for (const len of lengths) {
      for (let d = 0; d < len; d++) {
        days.push(day(addDays(cursor, d), { bleeding: d < 4 ? 'moderate' : 'none' }))
      }
      cursor = addDays(cursor, len)
    }
    const cycles = segmentCycles(days)
    expect(cycles.slice(0, 4).map((c) => c.lengthDays)).toEqual(lengths)
    expect(summariseCycles(cycles).regularity).toBe('variable')
  })

  it('summarises regularity from the observed spread', () => {
    const tight = segmentCycles(buildRegularRecord('2026-01-01', 4, 28).days)
    expect(summariseCycles(tight).regularity).toBe('regular')
    expect(summariseCycles(tight).medianLength).toBe(28)
  })
})

// ---------------------------------------------------------------------------
// Phase alignment
// ---------------------------------------------------------------------------

describe('phase alignment', () => {
  const record = buildRegularRecord('2026-01-01', 3)
  const cycles = segmentCycles(record.days)
  const aligned = alignToCycles(
    record.days.map((d) => d.date),
    cycles,
  )

  it('labels the onset day D0', () => {
    expect(aligned.get('2026-01-01')!.signedCycleDay).toBe(0)
    expect(aligned.get('2026-01-01')!.dayInCycle).toBe(0)
  })

  it('counts forward through the first half of the cycle', () => {
    expect(aligned.get('2026-01-04')!.signedCycleDay).toBe(3)
  })

  it('expresses late-luteal days as negative offsets from the next onset', () => {
    // 2026-01-27 is 26 days into a 28-day cycle -> two days before the next period.
    expect(aligned.get('2026-01-27')!.signedCycleDay).toBe(-2)
    expect(aligned.get('2026-01-28')!.signedCycleDay).toBe(-1)
    expect(aligned.get('2026-01-29')!.signedCycleDay).toBe(0) // next onset
  })

  it('places the D-2..D+3 window around onset', () => {
    const inWindow = (d: string) => aligned.get(d)!.inMenstrualWindow
    expect(inWindow('2026-01-27')).toBe(true) // D-2
    expect(inWindow('2026-01-28')).toBe(true) // D-1
    expect(inWindow('2026-01-01')).toBe(true) // D0
    expect(inWindow('2026-01-04')).toBe(true) // D+3
    expect(inWindow('2026-01-05')).toBe(false) // D+4
    expect(inWindow('2026-01-15')).toBe(false) // mid-cycle
  })

  it('normalises phase angle by each cycle’s own length', () => {
    // Halfway through a 28-day cycle is pi radians regardless of any 28-day assumption.
    expect(aligned.get('2026-01-15')!.phaseAngle).toBeCloseTo(Math.PI, 6)
  })

  it('leaves phase angle undefined for the incomplete trailing cycle', () => {
    const last = record.days[record.days.length - 1].date
    expect(Number.isNaN(aligned.get(last)!.phaseAngle)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The missing-data invariant
// ---------------------------------------------------------------------------

describe('missing data is never treated as zero', () => {
  const base = buildRegularRecord('2026-01-01', 3)
  // Mark pelvic pain present on the first 3 days of each cycle, absent otherwise.
  for (const d of base.days) {
    const dayInCycle = daysBetween('2026-01-01', d.date) % 28
    d.symptoms = {
      pelvic_pain:
        dayInCycle < 3 ? { state: 'present', severity: 7 } : { state: 'absent' },
    }
  }
  base.trackedSymptomIds = ['pelvic_pain']

  it('excludes unlogged days from every denominator', () => {
    const before = buildFeatureContext(base)
    const beforeFeatures = before.features.get('pelvic_pain')!

    // Blank out 20 days entirely.
    const withGaps: PatientRecord = {
      ...base,
      days: base.days.map((d, i) =>
        i % 4 === 0 ? { date: d.date, logged: false, symptoms: {} } : d,
      ),
    }
    const after = buildFeatureContext(withGaps, before.window)
    const afterFeatures = after.features.get('pelvic_pain')!

    // Counts drop because fewer days were observed...
    expect(afterFeatures.observedDays).toBeLessThan(beforeFeatures.observedDays)
    // ...but the RATE is essentially unchanged: unknown days left the denominator
    // rather than being counted as "no symptom".
    expect(afterFeatures.menstrualWindowRate).toBeGreaterThan(0.5)
    expect(afterFeatures.nonMenstrualRate).toBeCloseTo(0, 6)
  })

  it('distinguishes an absent observation from an unasked one', () => {
    const asked = buildFeatureContext(base)
    expect(asked.features.get('pelvic_pain')!.observedDays).toBeGreaterThan(80)

    // Same days, but the symptom was never asked about.
    const unasked: PatientRecord = {
      ...base,
      days: base.days.map((d) => ({ ...d, symptoms: {} })),
    }
    expect(buildFeatureContext(unasked).features.get('pelvic_pain')?.observedDays ?? 0).toBe(0)
  })

  it('reports coverage separately from rate', () => {
    const ctx = buildFeatureContext({
      ...base,
      days: base.days.map((d, i) => (i % 2 === 0 ? { date: d.date, logged: false, symptoms: {} } : d)),
    })
    expect(ctx.coverage).toBeLessThan(0.6)
    expect(ctx.coverage).toBeGreaterThan(0.4)
  })

  it('drops days from co-occurrence unless BOTH symptoms were observed', () => {
    const days = [
      day('2026-01-01', { symptoms: { a: { state: 'present' }, b: { state: 'present' } } }),
      day('2026-01-02', { symptoms: { a: { state: 'present' } } }), // b unknown
      day('2026-01-03', { symptoms: { a: { state: 'absent' }, b: { state: 'absent' } } }),
    ]
    const ctx = buildFeatureContext({
      ...base,
      days,
      trackedSymptomIds: ['a', 'b'],
    })
    expect(pairedObservations(ctx, 'a', 'b').dates).toEqual(['2026-01-01', '2026-01-03'])
  })
})

// ---------------------------------------------------------------------------
// Detection behaviour on generated data
// ---------------------------------------------------------------------------

describe('pattern detection on generated data', () => {
  const strongCyclical = () =>
    generatePatient({
      patientId: 'p-cyclical',
      displayName: 'Cyclical',
      seed: 'test:cyclical',
      days: 180,
      endDate: '2026-09-01',
      meanCycleLength: 28,
      cycleLengthSd: 2,
      meanBleedDays: 5,
      missingness: { mode: 'mcar', rate: 0.1 },
      symptoms: [
        {
          id: 'painful_bm',
          cyclical: true,
          kappa: 6,
          mu: 0,
          baseRate: 0.03,
          amplitude: 0.7,
          severityMean: 5,
          askProbability: 1,
        },
      ],
    })

  const nonCyclical = () =>
    generatePatient({
      patientId: 'p-flat',
      displayName: 'Flat',
      seed: 'test:flat',
      days: 180,
      endDate: '2026-09-01',
      meanCycleLength: 28,
      cycleLengthSd: 2,
      meanBleedDays: 5,
      missingness: { mode: 'mcar', rate: 0.1 },
      symptoms: [
        {
          id: 'painful_bm',
          cyclical: false,
          kappa: 6,
          mu: 0,
          baseRate: 0.03,
          amplitude: 0.7,
          severityMean: 5,
          askProbability: 1,
        },
      ],
    })

  it('detects a strongly cyclical symptom', () => {
    const ctx = buildFeatureContext(strongCyclical(), undefined)
    const finding = detectCyclicity(ctx, 'painful_bm')
    expect(finding.test!.p).toBeLessThan(0.001)
    expect(finding.values.riskRatio).toBeGreaterThan(2)
    expect(finding.values.menstrualRate).toBeGreaterThan(finding.values.nonMenstrualRate)
  })

  it('does not flag a phase-independent symptom as cyclical', () => {
    const ctx = buildFeatureContext(nonCyclical(), undefined)
    const finding = detectCyclicity(ctx, 'painful_bm')
    expect(finding.test!.p).toBeGreaterThan(0.05)
    expect(finding.values.riskRatio).toBeLessThan(2.5)
  })

  it('holds expected marginal prevalence exactly matched between the two classes', () => {
    // The design property, stated exactly: averaged over a full cycle, a cyclical spec
    // and its non-cyclical twin have the SAME mean occurrence probability. This is what
    // makes the evaluation a test of phase structure rather than of overall frequency —
    // a detector that merely keys on "this symptom is frequent" scores at chance.
    const spec = { id: 'x', kappa: 6, mu: 0, baseRate: 0.03, amplitude: 0.7 }
    const steps = 720
    const meanOver = (cyclical: boolean) => {
      let sum = 0
      for (let i = 0; i < steps; i++) {
        sum += occurrenceProbability(
          { ...spec, cyclical },
          (2 * Math.PI * i) / steps,
          0,
        )
      }
      return sum / steps
    }
    expect(meanOver(true)).toBeCloseTo(meanOver(false), 10)
  })

  it('produces matched empirical prevalence across a cohort of seeds', () => {
    // The per-patient sampled count is genuinely noisy (a 92-day window contains only
    // ~3 phase peaks), so the empirical check is averaged over 40 independent seeds,
    // where the law of large numbers makes the comparison meaningful.
    const meanDaysPresent = (cyclical: boolean) => {
      let total = 0
      for (let s = 0; s < 40; s++) {
        const record = generatePatient({
          patientId: `pm-${s}`,
          displayName: 'PM',
          seed: `prevalence:${cyclical}:${s}`,
          days: 180,
          endDate: '2026-09-01',
          meanCycleLength: 28,
          cycleLengthSd: 2,
          meanBleedDays: 5,
          missingness: { mode: 'mcar', rate: 0 },
          symptoms: [
            { id: 'painful_bm', cyclical, kappa: 6, mu: 0, baseRate: 0.03, amplitude: 0.7, askProbability: 1 },
          ],
        })
        total += buildFeatureContext(record, { start: record.days[0].date, end: '2026-09-01' })
          .features.get('painful_bm')!.daysPresent
      }
      return total / 40
    }
    const ratio = meanDaysPresent(true) / meanDaysPresent(false)
    expect(ratio).toBeGreaterThan(0.9)
    expect(ratio).toBeLessThan(1.1)
  })

  it('matches the analytic mean density used for prevalence matching', () => {
    // E[exp(k(cos t - 1))] = I0(k) e^-k. Spot-check against known Bessel values.
    expect(meanVonMisesDensity(0)).toBeCloseTo(1, 10)
    expect(meanVonMisesDensity(1)).toBeCloseTo(1.2660658 * Math.exp(-1), 6)
    expect(meanVonMisesDensity(2)).toBeCloseTo(2.2795853 * Math.exp(-2), 6)
  })

  it('makes non-cyclical occurrence probability independent of phase', () => {
    const spec = {
      id: 'x',
      cyclical: false,
      kappa: 4,
      mu: 0,
      baseRate: 0.1,
      amplitude: 0.5,
    }
    const ps = [0, 1, 2, 3, 4, 5].map((t) => occurrenceProbability(spec, t, 0))
    for (const p of ps) expect(p).toBeCloseTo(ps[0], 12)
  })
})

// ---------------------------------------------------------------------------
// Whole-engine guarantees
// ---------------------------------------------------------------------------

describe('pattern engine guarantees', () => {
  const record = generatePatient({
    patientId: 'p-engine',
    displayName: 'Engine',
    seed: 'test:engine',
    days: 120,
    endDate: '2026-09-01',
    meanCycleLength: 29,
    cycleLengthSd: 2,
    meanBleedDays: 5,
    missingness: { mode: 'mcar', rate: 0.12 },
    symptoms: [
      { id: 'pelvic_pain', cyclical: true, kappa: 5, mu: 0, baseRate: 0.12, amplitude: 0.6, severityMean: 6 },
      { id: 'fatigue', cyclical: false, kappa: 5, mu: 0, baseRate: 0.2, amplitude: 0.3, severityMean: 4 },
      { id: 'bloating', cyclical: true, kappa: 4, mu: 0.4, baseRate: 0.1, amplitude: 0.45, severityMean: 4 },
    ],
  })

  it('is deterministic — identical input gives byte-identical findings', () => {
    const a = runPatternEngine(buildFeatureContext(record))
    const b = runPatternEngine(buildFeatureContext(record))
    expect(JSON.stringify(a.findings)).toBe(JSON.stringify(b.findings))
  })

  it('never reads the ground-truth labels', () => {
    const withTruth = runPatternEngine(buildFeatureContext(record))
    const stripped: PatientRecord = { ...record, groundTruth: undefined }
    const withoutTruth = runPatternEngine(buildFeatureContext(stripped))
    expect(JSON.stringify(withoutTruth.findings)).toBe(JSON.stringify(withTruth.findings))
  })

  it('assigns a q-value to every hypothesis test', () => {
    const result = runPatternEngine(buildFeatureContext(record))
    const all = [...result.findings, ...result.suppressed].filter((f) => f.test)
    expect(all.length).toBeGreaterThan(0)
    for (const f of all) {
      expect(f.test!.q).toBeDefined()
      expect(f.test!.q!).toBeGreaterThanOrEqual(f.test!.p - 1e-12)
    }
  })

  it('suppresses rather than deletes findings that fail the gate', () => {
    const result = runPatternEngine(buildFeatureContext(record))
    expect(result.suppressed.length).toBeGreaterThan(0)
    for (const f of result.suppressed) {
      expect(f.passed).toBe(false)
      expect(f.gateReason).toBeDefined()
    }
    for (const f of result.findings) expect(f.passed).toBe(true)
  })

  it('attaches evidence dates to every reported finding', () => {
    const result = runPatternEngine(buildFeatureContext(record))
    for (const f of result.findings) {
      if (f.kind === 'functional_burden') continue
      expect(f.evidenceDates.length).toBeGreaterThan(0)
      // Every evidence date must be a real logged day in the window.
      for (const d of f.evidenceDates.slice(0, 5)) {
        expect(record.days.find((x) => x.date === d)?.logged).toBe(true)
      }
    }
  })

  it('gates everything when coverage is too low', () => {
    const sparse: PatientRecord = {
      ...record,
      days: record.days.map((d, i) => (i % 5 === 0 ? d : { date: d.date, logged: false, symptoms: {} })),
    }
    const result = runPatternEngine(buildFeatureContext(sparse))
    const gated = result.suppressed.filter((f) => f.gateReason === 'insufficient_coverage')
    expect(gated.length).toBeGreaterThan(0)
    expect(result.findings.filter((f) => f.kind === 'cyclicity')).toHaveLength(0)
  })

  it('detects an increase against the patient’s own prior cycles', () => {
    // Stated as a POWER claim across 20 independent seeds rather than a p-value at one
    // seed. A single-seed assertion here would be a coin flip dressed up as a test:
    // the comparison rests on ~22 non-menstrual days in the latest cycle, so even a
    // real effect lands above 0.05 on an unlucky draw. What we actually want to
    // guarantee is that the detector finds a real, sizeable change most of the time.
    const buildWorsening = (seed: number) =>
      generatePatient({
        patientId: `p-worse-${seed}`,
        displayName: 'Worsening',
        seed: `test:worsening:${seed}`,
        days: 150,
        endDate: '2026-09-01',
        meanCycleLength: 28,
        cycleLengthSd: 1.5,
        meanBleedDays: 5,
        missingness: { mode: 'mcar', rate: 0.08 },
        symptoms: [
          {
            id: 'pelvic_pain',
            cyclical: false,
            kappa: 0,
            mu: 0,
            baseRate: 0.03,
            amplitude: 0.0,
            drift: 0.14, // steady rise in non-menstrual pain across cycles
            severityMean: 6,
            askProbability: 1,
          },
        ],
      })

    let detected = 0
    let directionallyCorrect = 0
    const trials = 20

    for (let s = 0; s < trials; s++) {
      const record = buildWorsening(s)
      // The window must span the cycles being compared.
      const ctx = buildFeatureContext(record, {
        start: record.days[0].date,
        end: '2026-09-01',
      })
      const finding = detectBaselineChange(ctx, 'pelvic_pain', true)
      if (!finding) continue
      expect(finding.values.priorCycles).toBeGreaterThanOrEqual(2)
      if (finding.values.latestRate > finding.values.priorRate) directionallyCorrect++
      if (finding.test!.p < 0.05) detected++
    }

    // The estimate must point the right way essentially always...
    expect(directionallyCorrect).toBeGreaterThanOrEqual(trials - 1)
    // ...and reach significance in the clear majority of runs.
    expect(detected / trials).toBeGreaterThanOrEqual(0.7)
  })

  it('does not flag a single modest step between two adjacent cycles', () => {
    // The conservative counterpart to the test above: given only the last two cycles,
    // a small rate difference must not reach significance. This is the behaviour that
    // keeps "your symptoms changed this month" out of a brief when it is just noise.
    const mild = generatePatient({
      patientId: 'p-mild',
      displayName: 'Mild',
      seed: 'test:mild-step',
      days: 150,
      endDate: '2026-09-01',
      meanCycleLength: 28,
      cycleLengthSd: 1.5,
      meanBleedDays: 5,
      missingness: { mode: 'mcar', rate: 0.08 },
      symptoms: [
        { id: 'pelvic_pain', cyclical: false, kappa: 0, mu: 0, baseRate: 0.03, amplitude: 0, drift: 0.02, severityMean: 5, askProbability: 1 },
      ],
    })
    const ctx = buildFeatureContext(mild) // default 92-day window: two cycles
    const finding = detectBaselineChange(ctx, 'pelvic_pain', true)
    if (finding) expect(finding.test!.p).toBeGreaterThan(0.05)
  })
})
