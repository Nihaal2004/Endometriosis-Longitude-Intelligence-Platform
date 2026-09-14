/**
 * Timeline — the healthcare journey against the symptom record.
 *
 * The point of this screen is adjacency. Diagnostic-delay research describes symptoms,
 * consultations, investigations and treatments accumulating over years across different
 * clinicians, with no one view holding them together. Putting the burden ribbon directly
 * under the consultation markers makes the ordinary sequence visible: symptoms, a visit,
 * a normal scan, symptoms continuing.
 */

import { useMemo } from 'react'
import { BurdenRibbon } from '../charts'
import { useAnalysis, useRecord } from '../store'
import { dailyBurden } from '../../engine/features'
import { formatDateLong, pct } from '../../engine/brief'
import { BLEEDING_LEVELS, type ClinicalEventKind } from '../../engine/types'
import { daysBetween } from '../../engine/cycles'

const EVENT_LABELS: Record<ClinicalEventKind, string> = {
  gp: 'GP',
  gynaecology: 'Gynaecology',
  emergency: 'Emergency',
  referral: 'Referral',
  ultrasound: 'Ultrasound',
  mri: 'MRI',
  ct: 'CT',
  laparoscopy: 'Laparoscopy',
  surgery: 'Surgery',
  diagnosis: 'Diagnosis',
  fertility: 'Fertility',
  admission: 'Admission',
}

export default function Timeline() {
  const { ctx } = useAnalysis()
  const record = useRecord()

  const burden = useMemo(() => {
    const raw = dailyBurden(ctx)
    return raw.map((d) => ({
      date: d.date,
      burden: d.burden,
      bleeding: BLEEDING_LEVELS.indexOf(ctx.daysByDate.get(d.date)?.bleeding ?? 'none') > 2 ? 1 : 0,
    }))
  }, [ctx])

  const bands = useMemo(
    () => [
      ...record.treatments.map((t) => ({
        startDate: t.startDate,
        endDate: t.endDate,
        label: t.label,
        kind: 'treatment' as const,
      })),
      ...record.clinicalEvents
        .filter((e) => e.date >= ctx.window.start && e.date <= ctx.window.end)
        .map((e) => ({ startDate: e.date, label: e.label, kind: 'event' as const })),
    ],
    [record, ctx.window],
  )

  const eventsInWindow = record.clinicalEvents.filter(
    (e) => e.date >= ctx.window.start && e.date <= ctx.window.end,
  )
  const eventsBefore = record.clinicalEvents.filter((e) => e.date < ctx.window.start)

  return (
    <div className="space-y-5">
      <header>
        <h1 style={{ fontSize: 28 }}>Timeline</h1>
        <p className="mt-1 max-w-3xl text-[13.5px]" style={{ color: 'var(--ink-secondary)' }}>
          Daily symptom burden with treatment periods and healthcare events overlaid, so the
          sequence stays visible rather than each event standing alone.
        </p>
      </header>

      <section className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 style={{ fontSize: 17 }}>Symptom burden</h2>
          <span className="text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
            {formatDateLong(ctx.window.start)} – {formatDateLong(ctx.window.end)}
          </span>
        </div>

        <div className="mt-4">
          <BurdenRibbon days={burden} bands={bands} height={70} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px]"
          style={{ color: 'var(--ink-secondary)' }}>
          <Key color="var(--viz-seq-5)" label="Symptom burden" />
          <Key color="var(--bleed)" label="Bleeding day" />
          <Key color="var(--violet-soft)" label="On treatment" square />
          <Key color="var(--amber)" label="Healthcare event" />
          <span className="inline-flex items-center gap-2">
            <span aria-hidden style={{ width: 12, height: 3, borderRadius: 2, background: 'var(--hairline-strong)' }} />
            No entry
          </span>
        </div>
      </section>

      {record.treatments.length > 0 && (
        <section className="card p-5">
          <h2 style={{ fontSize: 17 }}>Treatment episodes</h2>
          <div className="mt-3 space-y-3">
            {record.treatments.map((t) => {
              const daysOn = daysBetween(t.startDate, t.endDate ?? ctx.window.end)
              return (
                <div key={t.id} className="rounded-xl p-4" style={{ background: 'var(--violet-soft)' }}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 style={{ fontSize: 16 }}>{t.label}</h3>
                    <span className="text-[12.5px] tnum" style={{ color: 'var(--ink-secondary)' }}>
                      {formatDateLong(t.startDate)} → {t.endDate ? formatDateLong(t.endDate) : 'ongoing'} · {daysOn} days
                    </span>
                  </div>
                  {t.reason && (
                    <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                      Started for: {t.reason}
                    </p>
                  )}
                  {t.sideEffects && t.sideEffects.length > 0 && (
                    <p className="mt-0.5 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                      Reported side effects: {t.sideEffects.join(', ')}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="card p-5">
        <h2 style={{ fontSize: 17 }}>Healthcare events</h2>
        {eventsBefore.length > 0 && (
          <div className="mt-3">
            <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
              Before this window
            </p>
            {eventsBefore.map((e) => (
              <EventRow key={e.id} date={e.date} kind={e.kind} label={e.label} reason={e.reason} outcome={e.outcome} />
            ))}
          </div>
        )}
        <div className="mt-4">
          <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
            In this window
          </p>
          {eventsInWindow.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>No recorded events in this period.</p>
          ) : (
            [...eventsInWindow]
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((e) => (
                <EventRow key={e.id} date={e.date} kind={e.kind} label={e.label} reason={e.reason} outcome={e.outcome} />
              ))
          )}
        </div>
      </section>

      <section className="card p-5">
        <h2 style={{ fontSize: 17 }}>Cycles observed</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {ctx.windowCycles.map((c) => (
            <div key={c.index} className="rounded-xl px-4 py-3" style={{ background: 'var(--surface-sunken)', minWidth: 132 }}>
              <div className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                Cycle {c.index + 1} {c.complete ? '' : '(ongoing)'}
              </div>
              <div className="display tnum" style={{ fontSize: 22 }}>
                {c.complete ? `${c.lengthDays}d` : '—'}
              </div>
              <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                from {c.startDate} · {c.bleedDays} bleed days
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          The ongoing cycle has no observed end, so it contributes no length and is excluded from
          anything that needs one. Coverage across this window is {pct(ctx.coverage)}%.
        </p>
      </section>
    </div>
  )
}

function Key({ color, label, square }: { color: string; label: string; square?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden style={{
        width: square ? 12 : 10, height: square ? 12 : 10,
        borderRadius: square ? 3 : 999, background: color, display: 'inline-block',
      }} />
      {label}
    </span>
  )
}

function EventRow({
  date, kind, label, reason, outcome,
}: {
  date: string
  kind: ClinicalEventKind
  label: string
  reason?: string
  outcome?: string
}) {
  return (
    <div className="flex gap-3 py-2.5" style={{ borderBottom: '1px solid var(--hairline)' }}>
      <span className="tnum shrink-0 text-[12.5px]" style={{ color: 'var(--ink-muted)', minWidth: 112 }}>
        {formatDateLong(date)}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[14px] font-medium">{label}</span>
          <span className="rounded-full px-2 py-0.5 text-[11px]"
            style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}>
            {EVENT_LABELS[kind]}
          </span>
        </div>
        {reason && <div className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>{reason}</div>}
        {outcome && <div className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>→ {outcome}</div>}
      </div>
    </div>
  )
}
