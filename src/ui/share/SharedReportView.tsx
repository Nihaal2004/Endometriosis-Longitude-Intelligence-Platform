/**
 * SharedReportView — renders a SharedReport snapshot.
 *
 * Used twice, on purpose: as the patient's preview before a link is created, and
 * as the page a clinician opens. One component means the preview cannot drift
 * from what is actually shared.
 */

import { formatDateLong } from '../../engine/brief'
import type { SharedReport } from './snapshot'
import { BACKGROUND_GROUP_TITLES, type BackgroundLine } from './background'

const STATUS: Record<NonNullable<SharedReport['patient']['diagnosisStatus']>, string> = {
  confirmed: 'Endometriosis confirmed',
  suspected: 'Suspected endometriosis',
  undiagnosed: 'Not yet diagnosed',
}

export function SharedReportView({ report, expiresAt }: { report: SharedReport; expiresAt?: string }) {
  const p = report.period
  const coverage = p.calendarDays > 0 ? Math.round((p.loggedDays / p.calendarDays) * 100) : 0

  return (
    <article className="card p-6 sm:p-8">
      <div className="pb-5" style={{ borderBottom: '2px solid var(--ink)' }}>
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--ink-muted)' }}>
          Patient-reported symptom summary
        </p>
        <h1 className="mt-1" style={{ fontSize: 26 }}>Longitudinal symptom summary</h1>
        <p className="mt-1.5 text-[13.5px]" style={{ color: 'var(--ink-secondary)' }}>
          {[
            report.patient.displayName ?? 'Name withheld by the patient',
            report.patient.diagnosisStatus && STATUS[report.patient.diagnosisStatus],
          ].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-1 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          {formatDateLong(p.start)} – {formatDateLong(p.end)} · {p.loggedDays} of {p.calendarDays} days logged ({coverage}%)
          · {p.completeCycles} complete cycle{p.completeCycles === 1 ? '' : 's'}
        </p>
      </div>

      {report.concerns && report.concerns.length > 0 && (
        <Block title="Main concerns">
          <ol className="space-y-1">
            {report.concerns.map((c, i) => (
              <li key={c} className="flex gap-2.5 text-[14.5px]">
                <span className="tnum" style={{ color: 'var(--ink-muted)' }}>{i + 1}.</span>
                <span>{c}</span>
              </li>
            ))}
          </ol>
          {report.patient.priorLabels && (
            <p className="mt-3 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
              <strong style={{ color: 'var(--ink)' }}>Previous labels: </strong>
              {report.patient.priorLabels.join('; ')}
            </p>
          )}
        </Block>
      )}

      {report.summary && report.summary.length > 0 && (
        <Block title="Summary in plain words">
          <p className="text-[14.5px] leading-relaxed">{report.summary.join(' ')}</p>
          <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
            Written by an AI from the findings below. Every number in it was checked against the patient’s entries.
          </p>
        </Block>
      )}

      {report.sections.map((s) => (
        <Block key={s.id} title={s.title}>
          <div className="space-y-2.5">
            {s.claims.map((c, i) => (
              <p key={i} className="text-[14.5px] leading-relaxed">{c.text}</p>
            ))}
          </div>
        </Block>
      ))}

      {report.background && report.background.length > 0 && (
        <Block title="Background">
          <BackgroundList lines={report.background} />
        </Block>
      )}

      {report.treatments && report.treatments.length > 0 && (
        <Block title="Treatments">
          <ul className="space-y-1.5 text-[14px]">
            {report.treatments.map((t) => (
              <li key={`${t.label}-${t.startDate}`}>
                <strong>{t.label}</strong>
                <span style={{ color: 'var(--ink-secondary)' }}>
                  {', '}{formatDateLong(t.startDate)} to {t.endDate ? formatDateLong(t.endDate) : 'ongoing'}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {report.timeline && report.timeline.length > 0 && (
        <Block title="Appointments and tests">
          <ul className="space-y-2">
            {report.timeline.map((e) => (
              <li key={`${e.date}-${e.label}`} className="flex gap-3 text-[13.5px]">
                <span className="tnum shrink-0" style={{ color: 'var(--ink-muted)', minWidth: 112 }}>
                  {formatDateLong(e.date)}
                </span>
                <span>
                  <strong>{e.label}</strong>
                  {e.reason && <span style={{ color: 'var(--ink-secondary)' }}>: {e.reason}</span>}
                  {e.outcome && <span className="block" style={{ color: 'var(--ink-secondary)' }}>{e.outcome}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <p className="mt-6 rounded-xl p-4 text-[12.5px] leading-relaxed"
        style={{ background: 'var(--surface-sunken)', color: 'var(--ink-secondary)' }}>
        {report.safetyStatement} Every figure was computed from the patient’s own entries and checked
        against them before this report was created.
        {expiresAt && ` This link expires on ${formatDateLong(expiresAt.slice(0, 10))}.`}
      </p>
    </article>
  )
}

/** Patient-reported baseline, grouped. Shared with the report screen and its PDF. */
export function BackgroundList({ lines }: { lines: BackgroundLine[] }) {
  const groups = (['history', 'menstrual', 'fertility'] as const).filter((g) => lines.some((l) => l.group === g))
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-1 text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>{BACKGROUND_GROUP_TITLES[g]}</p>
          <dl className="space-y-0.5 text-[13px]">
            {lines.filter((l) => l.group === g).map((l) => (
              <div key={l.label} className="flex justify-between gap-3">
                <dt style={{ color: 'var(--ink-secondary)' }}>{l.label}</dt>
                <dd className="text-right" style={{ color: 'var(--ink)' }}>{l.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2.5 text-[11.5px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: 'var(--ink-muted)', fontFamily: 'var(--font-ui)' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}
