/**
 * Insights — every piece of analysis, kept out of the daily flow.
 *
 * Segments: Report (the clinician brief), Patterns, Timeline. Until there is enough data for the evidence gate, a
 * progress card explains exactly what is still needed rather than leaving the
 * patient to wonder why the page is empty.
 */

import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { DEFAULT_GATE } from '../../engine/patterns'
import { useAnalysis, useData } from '../data'
import Brief from './Brief'
import Patterns from './Patterns'
import Timeline from './Timeline'

const SECTIONS = [
  { id: 'report', label: 'Report' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'timeline', label: 'Timeline' },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

export default function Insights() {
  const { section = 'report' } = useParams()
  const navigate = useNavigate()
  if (!SECTIONS.some((s) => s.id === section)) return <Navigate to="/insights/report" replace />
  const current = section as SectionId

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 style={{ fontSize: 28 }}>Insights</h1>
        <div className="segmented" role="tablist" aria-label="Insights sections">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={current === s.id}
              className="focus-ring" onClick={() => navigate(`/insights/${s.id}`)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <EvidenceProgress />

      {current === 'report' && <Brief />}
      {current === 'patterns' && <Patterns />}
      {current === 'timeline' && <Timeline />}
    </div>
  )
}

/**
 * What the evidence gate still needs, in plain terms. Shown until the patient has
 * enough data for findings to be reported at all.
 */
function EvidenceProgress() {
  const { mode, record } = useData()
  const { ctx } = useAnalysis()
  const cycles = ctx.windowCycles.filter((c) => c.complete).length
  const coverage = ctx.coverage
  const enough = cycles >= DEFAULT_GATE.minCompleteCycles && coverage >= DEFAULT_GATE.minCoverage

  if (enough || mode === 'demo') return null

  const pct = (x: number) => `${Math.round(x * 100)}%`
  return (
    <section className="card p-5">
      <h2 style={{ fontSize: 17 }}>Your patterns are still forming</h2>
      <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        MedTrace only reports a pattern once there is enough data to back it up, usually two
        complete cycles with most days logged. Until then it says nothing rather than guess.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Progress label="Complete cycles" value={`${cycles} of ${DEFAULT_GATE.minCompleteCycles}`}
          fraction={cycles / DEFAULT_GATE.minCompleteCycles} />
        <Progress label="Days logged" value={pct(coverage)} sub={`aim for ${pct(DEFAULT_GATE.minCoverage)}+`}
          fraction={coverage / DEFAULT_GATE.minCoverage} />
        <Progress label="Entries so far" value={String(record.days.length)} fraction={Math.min(1, record.days.length / 60)} />
      </div>
      {record.days.length > 0 && !record.days.some((d) => d.bleeding && d.bleeding !== 'none' && d.bleeding !== 'spotting') && (
        <p className="mt-4 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          Tip: cycles are counted from the first day of each period, so logging bleeding is what starts them.
        </p>
      )}
    </section>
  )
}

function Progress({ label, value, sub, fraction }: { label: string; value: string; sub?: string; fraction: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>{label}</span>
        <span className="display tnum" style={{ fontSize: 20 }}>{value}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunken)' }}>
        <div style={{ width: `${Math.max(3, Math.min(1, fraction) * 100)}%`, height: '100%', background: 'var(--ink)', borderRadius: 999 }} />
      </div>
      {sub && <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>{sub}</p>}
    </div>
  )
}
