/**
 * Patterns — what the engine found, in words a patient uses.
 *
 * The statistics behind every card (tests, intervals, corrections) live in the
 * clinician report and its evidence drawer. Here each finding is one plain
 * sentence and a picture. Patterns without enough data yet are still listed, so
 * a missing pattern reads as "not known yet" rather than "not there".
 */

import { useEffect, useMemo, useState } from 'react'
import { DataTable, PhaseHeatmap, SequentialLegend, Sparkline, TableView, type PhaseRow } from '../charts'
import { useAnalysis, useCustomLabels } from '../data'
import { phaseProfile } from '../../engine/features'
import { symptomLabel } from '../../engine/symptoms'
import { pct, round } from '../../engine/brief'
import type { Finding, GateReason } from '../../engine/types'

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const DAY_RANGE = range(-5, 8)
// On a phone, fewer columns keep each square big enough to read and tap.
const DAY_RANGE_NARROW = range(-3, 5)

function useNarrowScreen(maxWidth = 480): boolean {
  const query = `(max-width: ${maxWidth}px)`
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return narrow
}

const GATE_COPY: Record<GateReason, string> = {
  insufficient_coverage: 'Log more days to check this',
  insufficient_cycles: 'Needs at least two full cycles',
  insufficient_events: 'Not logged often enough yet',
  not_significant: 'No clear pattern',
}

const KIND_COPY: Record<string, string> = {
  cyclicity: 'link to your period',
  trend: 'change over time',
  baseline_change: 'change from usual',
  treatment_response: 'change since treatment',
  functional_burden: 'effect on daily life',
}

function peakText(day: number): string {
  if (day === 0) return 'Usually worst on the first day of your period'
  if (day < 0) return `Usually worst ${Math.abs(day)} day${day === -1 ? '' : 's'} before your period starts`
  return `Usually worst ${day} day${day === 1 ? '' : 's'} after your period starts`
}

export default function Patterns() {
  const { ctx, patterns } = useAnalysis()
  const labels = useCustomLabels()
  const name = (f: Finding) => symptomLabel(f.symptomId!, labels)
  const days = useNarrowScreen() ? DAY_RANGE_NARROW : DAY_RANGE

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
        label: symptomLabel(f.symptomId, labels),
        cells: phaseProfile(ctx, f.symptomId, -5, 8).map((b) => ({
          day: b.signedCycleDay,
          rate: b.rate,
          present: b.present,
          observed: b.observed,
        })),
      })),
    [ctx, tracked, labels],
  )

  const maxRate = Math.max(
    0.01,
    ...heatmapRows.flatMap((r) =>
      r.cells.filter((c) => days.includes(c.day)).map((c) => (Number.isFinite(c.rate) ? c.rate : 0)),
    ),
  )

  const cyclical = patterns.findings.filter((f) => f.kind === 'cyclicity')
  const persistent = patterns.findings.filter((f) => f.kind === 'persistence' && f.values.nonMenstrualRate >= 0.2)
  const trends = patterns.findings.filter((f) => f.kind === 'trend')
  const changes = patterns.findings.filter((f) => f.kind === 'baseline_change')
  const treatment = patterns.findings.filter((f) => f.kind === 'treatment_response')
  const together = patterns.findings.filter((f) => f.kind === 'co_occurrence' && f.values.kappa > 0)
  const notYet = patterns.suppressed.filter(
    (f) => f.gateReason !== 'not_significant' && f.kind !== 'persistence' && f.kind !== 'co_occurrence',
  )
  const cycles = ctx.windowCycles.filter((c) => c.complete).length

  return (
    <div className="space-y-5">
      <header>
        <h1 style={{ fontSize: 28 }}>Patterns</h1>
        <p className="mt-1 text-[13.5px]" style={{ color: 'var(--ink-secondary)' }}>
          From {ctx.loggedDays} days you logged, over {cycles} full cycle{cycles === 1 ? '' : 's'}.
        </p>
      </header>

      {/* ---------------- When symptoms happen ---------------- */}
      <section className="card p-5">
        <h2 style={{ fontSize: 18 }}>When your symptoms happen</h2>
        <p className="mt-1 max-w-3xl text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
          Darker squares mean it happened more often on that day. Day 0 is the first day of your period.
        </p>

        <div className="mt-4">
          <PhaseHeatmap rows={heatmapRows} dayRange={days} />
        </div>
        <div className="mt-3">
          <SequentialLegend max={maxRate} />
        </div>

        <TableView>
          <DataTable
            head={['Symptom', ...days.map((d) => (d === 0 ? 'Day 0' : d > 0 ? `+${d}` : String(d)))]}
            rows={heatmapRows.map((r) => [
              r.label,
              ...days.map((d) => {
                const c = r.cells.find((x) => x.day === d)
                if (!c || c.observed === 0) return '-'
                return `${c.present}/${c.observed}`
              }),
            ])}
          />
        </TableView>
      </section>

      {/* ---------------- Findings ---------------- */}
      {cyclical.length > 0 && (
        <Group title="Linked to your period">
          {cyclical.map((f) => (
            <article key={f.id} className="card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h3 style={{ fontSize: 17 }}>{name(f)}</h3>
                  <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
                    {peakText(Math.round(f.values.peakCycleDay))}
                  </p>
                </div>
                <div className="text-right">
                  <div className="display tnum" style={{ fontSize: 28, lineHeight: 1 }}>
                    {round(f.values.riskRatio, 1)}×
                  </div>
                  <div className="text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>more often around your period</div>
                </div>
              </div>
              <div className="mt-3.5 space-y-2">
                <RateBar label="Around your period" present={f.values.menstrualPresent}
                  observed={f.values.menstrualObserved} rate={f.values.menstrualRate} color="var(--bleed)" />
                <RateBar label="Other days" present={f.values.nonMenstrualPresent}
                  observed={f.values.nonMenstrualObserved} rate={f.values.nonMenstrualRate} color="var(--sage)" />
              </div>
            </article>
          ))}
        </Group>
      )}

      {persistent.length > 0 && (
        <Group title="Also happens at other times">
          {persistent.map((f) => (
            <Card key={f.id} title={name(f)} big={`${pct(f.values.nonMenstrualRate)}%`}>
              Logged on {f.values.nonMenstrualPresent} of {f.values.nonMenstrualObserved} days away from your period.
            </Card>
          ))}
        </Group>
      )}

      {trends.length > 0 && (
        <Group title="Changing over time">
          {trends.map((f) => {
            const rising = f.values.slopePerCycle > 0
            return (
              <div key={f.id} className="card flex flex-wrap items-center justify-between gap-4 p-4">
                <div>
                  <h3 style={{ fontSize: 16 }}>{name(f)} is happening {rising ? 'more' : 'less'} often</h3>
                  <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                    {pct(f.values.firstCycleRate)}% of days in your first cycle, {pct(f.values.lastCycleRate)}% in your latest.
                  </p>
                </div>
                <Sparkline
                  values={ctx.features.get(f.symptomId!)?.perCycleRates ?? []}
                  color={rising ? 'var(--viz-series-3)' : 'var(--viz-series-2)'}
                />
              </div>
            )
          })}
        </Group>
      )}

      {changes.length > 0 && (
        <Group title="Different from usual">
          {changes.map((f) => (
            <Card key={f.id} title={name(f)}>
              {pct(f.values.latestRate)}% of days this cycle, compared with {pct(f.values.priorRate)}% before.
            </Card>
          ))}
        </Group>
      )}

      {treatment.length > 0 && (
        <Group title="Since you started treatment">
          {treatment.map((f) => (
            <Card key={f.id} title={name(f)}>
              {pct(f.values.beforeRate)}% of days before, {pct(f.values.duringRate)}% since. This alone doesn’t
              prove the treatment caused the change.
            </Card>
          ))}
        </Group>
      )}

      {together.length > 0 && (
        <Group title="Often happen together">
          <div className="card p-4">
            <ul className="space-y-1.5 text-[14px]">
              {together.map((f) => (
                <li key={f.id}>
                  {symptomLabel(f.symptomId!, labels)} and {symptomLabel(f.secondarySymptomId!, labels).toLowerCase()}
                </li>
              ))}
            </ul>
          </div>
        </Group>
      )}

      {/* ---------------- Not enough data yet ---------------- */}
      {notYet.length > 0 && (
        <section className="card p-5" style={{ background: 'var(--surface-sunken)' }}>
          <h2 style={{ fontSize: 18 }}>Not enough data yet</h2>
          <p className="mt-1 max-w-3xl text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
            Keep logging and these will be checked again.
          </p>
          <ul className="mt-3 space-y-2">
            {notYet.slice(0, 8).map((f) => (
              <li key={f.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl px-3.5 py-2.5"
                style={{ background: 'var(--surface)' }}>
                <span className="text-[13.5px]" style={{ color: 'var(--ink)' }}>
                  {f.symptomId ? symptomLabel(f.symptomId, labels) : 'Daily life'}
                  <span style={{ color: 'var(--ink-muted)' }}> · {KIND_COPY[f.kind] ?? f.kind.replace(/_/g, ' ')}</span>
                </span>
                <span className="text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>{GATE_COPY[f.gateReason!]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3" style={{ fontSize: 18 }}>{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Card({ title, big, children }: { title: string; big?: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 style={{ fontSize: 16 }}>{title}</h3>
        {big && <span className="display tnum" style={{ fontSize: 24 }}>{big}</span>}
      </div>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>{children}</p>
    </div>
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
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
        <span>{label}</span>
        <span className="tnum">{present} of {observed} days</span>
      </div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunken)' }}>
        <div style={{ width: `${Math.max(1.5, rate * 100)}%`, height: '100%', background: color, borderRadius: 999 }} />
      </div>
    </div>
  )
}
