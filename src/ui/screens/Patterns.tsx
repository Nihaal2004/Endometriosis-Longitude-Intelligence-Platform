/**
 * Patterns — what the engine found, and what it refused to say.
 *
 * Every finding card carries its test name, effect size, confidence interval and the
 * coverage it rests on. That is not decoration: a rate ratio of 4.1 from 11 observed
 * days and one from 80 are different evidence, and a card that showed only "4.1x"
 * would let a reader treat them as the same.
 *
 * Suppressed findings are shown too, with the reason. Silently omitting them would
 * invite the reader to treat absence of evidence as evidence of absence.
 */

import { useMemo, useState } from 'react'
import {
  CoOccurrenceMatrix,
  DataTable,
  DivergingLegend,
  PhaseHeatmap,
  SequentialLegend,
  Sparkline,
  TableView,
  type PhaseRow,
} from '../charts'
import { useAnalysis, useCustomLabels } from '../data'
import { phaseProfile } from '../../engine/features'
import { clinicalLabel, symptomLabel } from '../../engine/symptoms'
import { formatP, pct, round } from '../../engine/brief'
import type { Finding, GateReason } from '../../engine/types'

const DAY_RANGE = Array.from({ length: 14 }, (_, i) => i - 5) // D-5 … D+8

const GATE_COPY: Record<GateReason, string> = {
  insufficient_coverage: 'Not enough logged days to support a reliable rate',
  insufficient_cycles: 'Needs at least two complete cycles',
  insufficient_events: 'Too few recorded occurrences',
  not_significant: 'Difference is within what chance would produce',
}

export default function Patterns() {
  const { ctx, patterns } = useAnalysis()
  const customLabels = useCustomLabels()
  const [openId, setOpenId] = useState<string | null>(null)

  const tracked = useMemo(
    () =>
      [...ctx.features.values()]
        .filter((f) => f.daysPresent >= 2)
        .sort((a, b) => b.daysPresent - a.daysPresent)
        .slice(0, 7),
    [ctx],
  )

  const heatmapRows: PhaseRow[] = useMemo(
    () =>
      tracked.map((f) => ({
        label: symptomLabel(f.symptomId, customLabels),
        cells: phaseProfile(ctx, f.symptomId, -5, 8).map((b) => ({
          day: b.signedCycleDay,
          rate: b.rate,
          present: b.present,
          observed: b.observed,
        })),
      })),
    [ctx, tracked, customLabels],
  )

  const maxRate = Math.max(
    0.01,
    ...heatmapRows.flatMap((r) => r.cells.map((c) => (Number.isFinite(c.rate) ? c.rate : 0))),
  )

  const cyclicity = patterns.findings.filter((f) => f.kind === 'cyclicity')
  const trends = patterns.findings.filter((f) => f.kind === 'trend')
  const changes = patterns.findings.filter((f) => f.kind === 'baseline_change')
  const treatment = patterns.findings.filter((f) => f.kind === 'treatment_response')
  const persistence = patterns.findings.filter(
    (f) => f.kind === 'persistence' && f.values.nonMenstrualRate >= 0.2,
  )

  // Suppressed findings worth surfacing: exclude the ones that are merely "no effect",
  // which would otherwise drown the list.
  const gated = patterns.suppressed.filter(
    (f) => f.gateReason !== 'not_significant' && f.kind !== 'persistence' && f.kind !== 'co_occurrence',
  )

  const coOccur = patterns.findings.filter((f) => f.kind === 'co_occurrence')
  const matrixLabels = useMemo(() => {
    const ids = new Set<string>()
    for (const f of [...coOccur, ...patterns.suppressed.filter((x) => x.kind === 'co_occurrence')]) {
      if (f.symptomId) ids.add(f.symptomId)
      if (f.secondarySymptomId) ids.add(f.secondarySymptomId)
    }
    return [...ids]
  }, [coOccur, patterns.suppressed])

  const matrixValues = useMemo(() => {
    const all = [...coOccur, ...patterns.suppressed.filter((x) => x.kind === 'co_occurrence')]
    return matrixLabels.map((a) =>
      matrixLabels.map((b) => {
        if (a === b) return Number.NaN
        const f = all.find(
          (x) =>
            (x.symptomId === a && x.secondarySymptomId === b) ||
            (x.symptomId === b && x.secondarySymptomId === a),
        )
        return f ? f.values.kappa : Number.NaN
      }),
    )
  }, [matrixLabels, coOccur, patterns.suppressed])

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 style={{ fontSize: 28 }}>Patterns</h1>
          <p className="mt-1 text-[13.5px]" style={{ color: 'var(--ink-secondary)' }}>
            {ctx.loggedDays} of {ctx.calendarDays} days logged ·{' '}
            {ctx.windowCycles.filter((c) => c.complete).length} complete cycles in this window ·{' '}
            {patterns.testsRun} statistical tests run
          </p>
        </div>
        <div className="rounded-full px-3.5 py-1.5 text-[12.5px]"
          style={{ background: 'var(--surface-sunken)', color: 'var(--ink-secondary)' }}>
          {pct(ctx.coverage)}% coverage
        </div>
      </header>

      {/* ---------------- Phase heatmap ---------------- */}
      <section className="card p-5">
        <h2 style={{ fontSize: 18 }}>Symptoms by cycle day</h2>
        <p className="mt-1 max-w-3xl text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
          Each day is positioned relative to the nearest bleeding onset, using each cycle&apos;s own
          observed length. No 28-day cycle is assumed and no future cycle is predicted.
        </p>

        <div className="mt-4">
          <PhaseHeatmap rows={heatmapRows} dayRange={DAY_RANGE} />
        </div>

        <div className="mt-3">
          <SequentialLegend max={maxRate} />
        </div>

        <TableView>
          <DataTable
            head={['Symptom', ...DAY_RANGE.map((d) => (d === 0 ? 'D0' : d > 0 ? `+${d}` : String(d)))]}
            rows={heatmapRows.map((r) => [
              r.label,
              ...DAY_RANGE.map((d) => {
                const c = r.cells.find((x) => x.day === d)
                if (!c || c.observed === 0) return '—'
                return `${c.present}/${c.observed}`
              }),
            ])}
          />
        </TableView>
      </section>

      {/* ---------------- Findings ---------------- */}
      {cyclicity.length > 0 && (
        <FindingGroup
          title="Cyclical patterns"
          blurb="Symptoms concentrated around menstruation, tested against the rest of the cycle."
        >
          {cyclicity.map((f) => (
            <CyclicityCard key={f.id} f={f} open={openId === f.id} onToggle={() => setOpenId(openId === f.id ? null : f.id)} labels={customLabels} />
          ))}
        </FindingGroup>
      )}

      {persistence.length > 0 && (
        <FindingGroup
          title="Persistent symptoms"
          blurb="Present outside the perimenstrual window too — not confined to periods."
        >
          {persistence.map((f) => (
            <div key={f.id} className="card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 style={{ fontSize: 16 }}>{symptomLabel(f.symptomId!, customLabels)}</h3>
                <span className="display tnum" style={{ fontSize: 24 }}>
                  {pct(f.values.nonMenstrualRate)}%
                </span>
              </div>
              <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                {f.values.nonMenstrualPresent} of {f.values.nonMenstrualObserved} observed non-menstrual days
                (95% CI {pct(f.values.rateLow)}–{pct(f.values.rateHigh)}%)
              </p>
            </div>
          ))}
        </FindingGroup>
      )}

      {trends.length > 0 && (
        <FindingGroup title="Change across cycles" blurb="Mann–Kendall trend test on per-cycle occurrence rates.">
          {trends.map((f) => {
            const feature = ctx.features.get(f.symptomId!)
            return (
              <div key={f.id} className="card flex flex-wrap items-center justify-between gap-4 p-4">
                <div>
                  <h3 style={{ fontSize: 16 }}>{symptomLabel(f.symptomId!, customLabels)}</h3>
                  <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                    {pct(f.values.firstCycleRate)}% → {pct(f.values.lastCycleRate)}% across {f.values.cycles} cycles ·{' '}
                    {formatP(f.test!.p)}
                  </p>
                </div>
                <Sparkline
                  values={feature?.perCycleRates ?? []}
                  color={f.values.slopePerCycle > 0 ? 'var(--viz-series-3)' : 'var(--viz-series-2)'}
                />
              </div>
            )
          })}
        </FindingGroup>
      )}

      {changes.length > 0 && (
        <FindingGroup title="Change from your own baseline" blurb="Latest complete cycle against your previous cycles.">
          {changes.map((f) => (
            <div key={f.id} className="card p-4">
              <h3 style={{ fontSize: 16 }}>{symptomLabel(f.symptomId!, customLabels)}</h3>
              <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                {pct(f.values.latestRate)}% of non-menstrual days this cycle vs {pct(f.values.priorRate)}% across the
                previous {f.values.priorCycles} cycles · exact Poisson {formatP(f.test!.p)}
              </p>
            </div>
          ))}
        </FindingGroup>
      )}

      {treatment.length > 0 && (
        <FindingGroup title="Since treatment started" blurb="Recorded rates before and during treatment. Not a controlled comparison.">
          {treatment.map((f) => (
            <div key={f.id} className="card p-4">
              <h3 style={{ fontSize: 16 }}>{symptomLabel(f.symptomId!, customLabels)}</h3>
              <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                {pct(f.values.beforeRate)}% before → {pct(f.values.duringRate)}% during ·{' '}
                {formatP(f.test!.p)}
              </p>
            </div>
          ))}
        </FindingGroup>
      )}

      {/* ---------------- Co-occurrence ---------------- */}
      {matrixLabels.length > 1 && (
        <section className="card p-5">
          <h2 style={{ fontSize: 18 }}>Which symptoms travel together</h2>
          <p className="mt-1 max-w-3xl text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
            Cohen&apos;s κ, which discounts the overlap you would expect from two common symptoms
            coinciding by chance. Only days on which both were actually asked about are counted.
          </p>
          <div className="mt-4">
            <CoOccurrenceMatrix
              labels={matrixLabels.map((id) => symptomLabel(id, customLabels))}
              values={matrixValues}
            />
          </div>
          <div className="mt-3">
            <DivergingLegend />
          </div>
        </section>
      )}

      {/* ---------------- Withheld ---------------- */}
      <section className="card p-5" style={{ background: 'var(--surface-sunken)' }}>
        <h2 style={{ fontSize: 18 }}>Not enough evidence yet</h2>
        <p className="mt-1 max-w-3xl text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
          These were computed but withheld. They are shown so that a missing pattern is visibly
          withheld rather than quietly absent — which is not the same thing.
        </p>

        {gated.length === 0 ? (
          <p className="mt-3 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Nothing withheld for insufficient data in this window.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {gated.slice(0, 10).map((f) => (
              <li key={f.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl px-3.5 py-2.5"
                style={{ background: 'var(--surface)' }}>
                <span className="text-[13.5px]" style={{ color: 'var(--ink)' }}>
                  {f.symptomId ? symptomLabel(f.symptomId, customLabels) : 'Functional impact'}
                  <span style={{ color: 'var(--ink-muted)' }}> · {f.kind.replace(/_/g, ' ')}</span>
                </span>
                <span className="text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
                  {GATE_COPY[f.gateReason!]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function FindingGroup({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1" style={{ fontSize: 18 }}>{title}</h2>
      <p className="mb-3 max-w-3xl text-[13px]" style={{ color: 'var(--ink-secondary)' }}>{blurb}</p>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function CyclicityCard({
  f,
  open,
  onToggle,
  labels,
}: {
  f: Finding
  open: boolean
  onToggle: () => void
  labels: Record<string, string>
}) {
  const v = f.values
  const peak = Math.round(v.peakCycleDay)

  return (
    <article className="card overflow-hidden">
      <button
        onClick={onToggle}
        className="focus-ring w-full p-4 text-left"
        style={{ background: 'none', border: 'none' }}
        aria-expanded={open}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 style={{ fontSize: 17 }}>{symptomLabel(f.symptomId!, labels)}</h3>
            <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
              {clinicalLabel(f.symptomId!)} · peaks {peak === 0 ? 'on day 0' : peak < 0 ? `${Math.abs(peak)}d before bleeding` : `${peak}d after onset`}
            </p>
          </div>
          <div className="text-right">
            <div className="display tnum" style={{ fontSize: 28, lineHeight: 1 }}>
              {round(v.riskRatio, 1)}×
            </div>
            <div className="text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
              more likely perimenstrually
            </div>
          </div>
        </div>

        {/* Two-bar comparison. Labelled directly, so colour carries nothing alone. */}
        <div className="mt-3.5 space-y-2">
          <RateBar label="Perimenstrual" present={v.menstrualPresent} observed={v.menstrualObserved}
            rate={v.menstrualRate} color="var(--bleed)" />
          <RateBar label="Rest of cycle" present={v.nonMenstrualPresent} observed={v.nonMenstrualObserved}
            rate={v.nonMenstrualRate} color="var(--sage)" />
        </div>

        <p className="mt-3 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          {open ? 'Hide statistics' : 'Show statistics'}
        </p>
      </button>

      {open && (
        <div className="px-4 pb-4">
          <DataTable
            head={['Quantity', 'Value']}
            rows={[
              ['Test', f.test!.name],
              ['p-value', formatP(f.test!.p).replace('p ', '')],
              ['q-value (BH, within family)', f.test!.q!.toFixed(4)],
              ['Risk ratio', `${round(v.riskRatio, 2)} (95% CI ${round(v.riskRatioLow, 2)}–${round(v.riskRatioHigh, 2)})`],
              ['Perimenstrual rate', `${v.menstrualPresent}/${v.menstrualObserved} = ${pct(v.menstrualRate)}% (95% CI ${pct(v.menstrualRateLow)}–${pct(v.menstrualRateHigh)}%)`],
              ['Non-menstrual rate', `${v.nonMenstrualPresent}/${v.nonMenstrualObserved} = ${pct(v.nonMenstrualRate)}% (95% CI ${pct(v.nonMenstrualRateLow)}–${pct(v.nonMenstrualRateHigh)}%)`],
              ['Rayleigh test (secondary)', `R̄ = ${round(v.rayleighR, 3)}, ${formatP(v.rayleighP)}`],
              ['Cycles with symptom', `${v.cyclesWithSymptom} of ${v.cyclesObserved}`],
              ['Observation coverage', `${pct(f.coverage)}% (${f.observedDays} observed days)`],
            ]}
          />
          <p className="mt-2.5 text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            The Rayleigh test is reported as a cross-check: it treats the cycle as a circle and so has
            no window boundary, which means it cannot be an artefact of where the perimenstrual window
            was drawn.
          </p>
        </div>
      )}
    </article>
  )
}

function RateBar({
  label, present, observed, rate, color,
}: {
  label: string
  present: number
  observed: number
  rate: number
  color: string
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunken)' }}>
        <div style={{ width: `${Math.max(1.5, rate * 100)}%`, height: '100%', background: color, borderRadius: 999 }} />
      </div>
      <span className="w-24 shrink-0 text-right text-[12.5px] tnum" style={{ color: 'var(--ink-secondary)' }}>
        {present}/{observed} · {pct(rate)}%
      </span>
    </div>
  )
}
