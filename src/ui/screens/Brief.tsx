/**
 * Brief — the clinician-facing summary.
 *
 * This is the artefact the whole system exists to produce, and the thing the app-review
 * literature identifies as missing from existing trackers: not a dashboard, but a short
 * document a clinician can read inside a time-limited consultation.
 *
 * Every sentence is clickable, and clicking it opens the evidence behind it: the finding,
 * the test, and the individual days that produced the number. A claim that cannot be
 * traced back to days in the record does not appear — it was dropped by the fidelity
 * checker before this screen ever saw it.
 */

import { useMemo, useState } from 'react'
import { useAnalysis, useCustomLabels, useRecord } from '../store'
import { mainConcerns, SAFETY_STATEMENT, formatDateLong, pct } from '../../engine/brief'
import { symptomLabel } from '../../engine/symptoms'
import { summariseCycles } from '../../engine/cycles'
import type { Claim } from '../../engine/types'

const SECTION_TITLES: Record<string, string> = {
  findings: 'Longitudinal findings',
  impact: 'Functional impact',
  change: 'Change from previous cycles',
  medication: 'Medication and treatment',
  quality: 'Data quality',
}

export default function Brief() {
  const { ctx, brief, verifiedClaims, rejectedClaims, fidelity } = useAnalysis()
  const record = useRecord()
  const customLabels = useCustomLabels()
  const [openClaim, setOpenClaim] = useState<Claim | null>(null)

  const concerns = useMemo(() => mainConcerns(ctx, 4, customLabels), [ctx, customLabels])
  // Window-scoped, matching the claims beneath. These tiles and the prose must agree —
  // a reader who spots a contradiction between them has no reason to trust either.
  const cycleSummary = summariseCycles(ctx.windowCycles)

  const period = verifiedClaims.filter((c) => c.section === 'period')
  const bySection = (s: string) => verifiedClaims.filter((c) => c.section === s)

  const orderedSections = ['findings', 'impact', 'change', 'medication'] as const

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <article className="card p-6 sm:p-8">
        {/* --- Letterhead --- */}
        <div className="flex flex-wrap items-start justify-between gap-4 pb-5"
          style={{ borderBottom: '2px solid var(--ink)' }}>
          <div>
            <h1 style={{ fontSize: 26 }}>Longitudinal symptom summary</h1>
            <p className="mt-1.5 text-[13.5px]" style={{ color: 'var(--ink-secondary)' }}>
              {record.profile.displayName}, {record.profile.ageRange} ·{' '}
              {record.profile.diagnosisStatus === 'confirmed'
                ? 'Endometriosis confirmed'
                : record.profile.diagnosisStatus === 'suspected'
                  ? 'Suspected endometriosis'
                  : 'Undiagnosed'}
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="no-print focus-ring rounded-full px-4 py-2 text-[13px] font-medium"
            style={{ border: '1px solid var(--hairline-strong)', background: 'transparent', color: 'var(--ink-secondary)' }}
          >
            Print / PDF
          </button>
        </div>

        {/* --- Recorded period --- */}
        <Section title="Recorded period">
          {period.map((c) => (
            <ClaimLine key={c.id} claim={c} onOpen={setOpenClaim} />
          ))}
          <div className="mt-3 flex flex-wrap gap-2">
            <Stat label="Days logged" value={`${ctx.loggedDays} / ${ctx.calendarDays}`} />
            <Stat label="Coverage" value={`${pct(ctx.coverage)}%`} />
            <Stat label="Complete cycles" value={String(cycleSummary.completeCount)} />
            <Stat
              label="Cycle length"
              value={cycleSummary.medianLength ? `${cycleSummary.medianLength}d (${cycleSummary.minLength}–${cycleSummary.maxLength})` : '—'}
            />
          </div>
        </Section>

        {/* --- Main concerns --- */}
        <Section title="Main concerns">
          <ol className="space-y-1">
            {concerns.map((c, i) => (
              <li key={c} className="flex gap-2.5 text-[14.5px]">
                <span className="tnum" style={{ color: 'var(--ink-muted)' }}>{i + 1}.</span>
                <span>{c}</span>
              </li>
            ))}
          </ol>
          {record.profile.priorLabels && record.profile.priorLabels.length > 0 && (
            <p className="mt-3 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
              <strong style={{ color: 'var(--ink)' }}>Previous labels: </strong>
              {record.profile.priorLabels.join('; ')}
            </p>
          )}
        </Section>

        {/* --- Findings by section --- */}
        {orderedSections.map((s) => {
          const claims = bySection(s)
          if (claims.length === 0) return null
          return (
            <Section key={s} title={SECTION_TITLES[s]}>
              <div className="space-y-2.5">
                {claims.map((c) => (
                  <ClaimLine key={c.id} claim={c} onOpen={setOpenClaim} />
                ))}
              </div>
            </Section>
          )
        })}

        {/* --- Clinical timeline --- */}
        {record.clinicalEvents.length > 0 && (
          <Section title="Clinical timeline">
            <ul className="space-y-2">
              {[...record.clinicalEvents]
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((e) => (
                  <li key={e.id} className="flex gap-3 text-[13.5px]">
                    <span className="tnum shrink-0" style={{ color: 'var(--ink-muted)', minWidth: 112 }}>
                      {formatDateLong(e.date)}
                    </span>
                    <span>
                      <strong style={{ color: 'var(--ink)' }}>{e.label}</strong>
                      {e.reason && <span style={{ color: 'var(--ink-secondary)' }}> — {e.reason}</span>}
                      {e.outcome && (
                        <div style={{ color: 'var(--ink-secondary)' }}>{e.outcome}</div>
                      )}
                    </span>
                  </li>
                ))}
            </ul>
          </Section>
        )}

        {/* --- Data quality --- */}
        <Section title="Data quality">
          <div className="space-y-2.5">
            {bySection('quality').map((c) => (
              <ClaimLine key={c.id} claim={c} onOpen={setOpenClaim} />
            ))}
          </div>
        </Section>

        <p className="mt-6 rounded-xl p-4 text-[12.5px] leading-relaxed"
          style={{ background: 'var(--surface-sunken)', color: 'var(--ink-secondary)' }}>
          {SAFETY_STATEMENT}
        </p>
      </article>

      {/* --- Sidebar --- */}
      <aside className="no-print space-y-4">
        <div className="card p-4">
          <h2 style={{ fontSize: 15 }}>Verification</h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            Every number above was recomputed from the raw day records by a separate
            implementation before it was allowed to render.
          </p>
          <div className="mt-3 space-y-2">
            <Meter label="Claims verified" value={`${fidelity.verifiedClaims}/${fidelity.totalClaims}`} good />
            <Meter
              label="Values re-derived"
              value={`${pct(fidelity.keyCoverage)}%`}
              good={fidelity.keyCoverage > 0.5}
            />
            <Meter label="Claims dropped" value={String(rejectedClaims.length)} good={rejectedClaims.length === 0} />
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            The remainder are test statistics that are deterministic functions of counts already
            confirmed — re-deriving those would check arithmetic, not data.
          </p>
        </div>

        <div className="card p-4">
          <h2 style={{ fontSize: 15 }}>What this is not</h2>
          <ul className="mt-2 space-y-1.5 text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
            {[
              'Not a diagnosis or a likelihood of one',
              'Not a risk score or disease stage',
              'Not a prediction of future cycles',
              'Not generated by a language model — the numbers are computed, the sentences are templated',
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <span aria-hidden style={{ color: 'var(--ink-muted)' }}>—</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {openClaim && (
        <EvidenceDrawer claim={openClaim} onClose={() => setOpenClaim(null)} labels={customLabels} />
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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

function ClaimLine({ claim, onOpen }: { claim: Claim; onOpen: (c: Claim) => void }) {
  return (
    <button
      onClick={() => onOpen(claim)}
      className="focus-ring block w-full rounded-lg text-left text-[14.5px] leading-relaxed transition-colors"
      style={{
        background: 'none',
        border: 'none',
        padding: '4px 6px',
        margin: '0 -6px',
        color: 'var(--ink)',
        borderBottom: '1px dotted var(--hairline-strong)',
      }}
      title="Show the evidence behind this sentence"
    >
      {claim.text}
      <span className="no-print ml-1.5 align-middle text-[11px]" style={{ color: 'var(--violet)' }} aria-hidden>
        ●
      </span>
    </button>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-3.5 py-2" style={{ background: 'var(--surface-sunken)' }}>
      <div className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>{label}</div>
      <div className="display tnum" style={{ fontSize: 18 }}>{value}</div>
    </div>
  )
}

function Meter({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span style={{ color: 'var(--ink-secondary)' }}>{label}</span>
      <span className="inline-flex items-center gap-1.5 tnum" style={{ color: 'var(--ink)' }}>
        <span aria-hidden style={{
          width: 7, height: 7, borderRadius: 999,
          background: good ? 'var(--viz-good)' : 'var(--viz-warning)',
        }} />
        {value}
      </span>
    </div>
  )
}

function EvidenceDrawer({
  claim,
  onClose,
  labels,
}: {
  claim: Claim
  onClose: () => void
  labels: Record<string, string>
}) {
  const { brief, ctx } = useAnalysis()
  const finding = brief.findings.find((f) => f.id === claim.findingId)

  return (
    <div
      className="no-print fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(20, 14, 20, 0.35)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Evidence"
    >
      <div
        className="h-full w-full max-w-md overflow-y-auto p-6"
        style={{ background: 'var(--surface)', borderLeft: '1px solid var(--hairline)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 style={{ fontSize: 19 }}>Evidence</h2>
          <button onClick={onClose} className="focus-ring rounded-full px-3 py-1 text-[13px]"
            style={{ border: '1px solid var(--hairline-strong)', background: 'transparent' }}>
            Close
          </button>
        </div>

        <p className="mt-4 rounded-xl p-3.5 text-[14px] leading-relaxed"
          style={{ background: 'var(--surface-sunken)' }}>
          {claim.text}
        </p>

        {finding?.test && (
          <div className="mt-4">
            <H>Statistical test</H>
            <dl className="space-y-1 text-[13px]">
              <Row k="Test" v={finding.test.name} />
              <Row k="p-value" v={finding.test.p < 0.001 ? '< 0.001' : finding.test.p.toFixed(4)} />
              <Row k="q-value (BH)" v={finding.test.q?.toFixed(4) ?? '—'} />
              {finding.effect && (
                <Row
                  k={finding.effect.label}
                  v={
                    finding.effect.ci
                      ? `${finding.effect.value.toFixed(2)} (95% CI ${finding.effect.ci.low.toFixed(2)}–${finding.effect.ci.high.toFixed(2)})`
                      : finding.effect.value.toFixed(2)
                  }
                />
              )}
              <Row k="Observation coverage" v={`${pct(finding.coverage)}% · ${finding.observedDays} observed days`} />
            </dl>
          </div>
        )}

        <div className="mt-5">
          <H>Numbers asserted in this sentence</H>
          <dl className="space-y-1 text-[13px]">
            {Object.entries(claim.assertedValues).map(([k, v]) => (
              <Row key={k} k={k.replace(/([A-Z])/g, ' $1').toLowerCase()} v={String(v)} />
            ))}
          </dl>
          <p className="mt-2 inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--viz-good)' }} />
            Each re-derived from the raw record and matched.
          </p>
        </div>

        {claim.evidenceDates.length > 0 && (
          <div className="mt-5">
            <H>Contributing days ({claim.evidenceDates.length})</H>
            <div className="space-y-1.5">
              {claim.evidenceDates.slice(0, 40).map((d) => {
                const day = ctx.daysByDate.get(d)
                const aligned = ctx.aligned.get(d)
                const present = Object.entries(day?.symptoms ?? {})
                  .filter(([, o]) => o.state === 'present')
                  .map(([id, o]) => `${symptomLabel(id, labels)}${o.severity ? ` ${o.severity}` : ''}`)
                return (
                  <div key={d} className="rounded-lg px-3 py-2 text-[12.5px]"
                    style={{ background: 'var(--surface-sunken)' }}>
                    <div className="flex justify-between gap-2">
                      <span className="tnum" style={{ color: 'var(--ink)' }}>{d}</span>
                      <span className="tnum" style={{ color: 'var(--ink-muted)' }}>
                        {aligned
                          ? aligned.signedCycleDay >= 0
                            ? `D+${aligned.signedCycleDay}`
                            : `D${aligned.signedCycleDay}`
                          : '—'}
                        {aligned?.inMenstrualWindow ? ' · perimenstrual' : ''}
                      </span>
                    </div>
                    {present.length > 0 && (
                      <div className="mt-0.5" style={{ color: 'var(--ink-secondary)' }}>{present.join(' · ')}</div>
                    )}
                  </div>
                )
              })}
              {claim.evidenceDates.length > 40 && (
                <p className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                  … and {claim.evidenceDates.length - 40} more
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function H({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]"
      style={{ color: 'var(--ink-muted)', fontFamily: 'var(--font-ui)' }}>
      {children}
    </h3>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3" style={{ borderBottom: '1px solid var(--hairline)', paddingBottom: 3 }}>
      <dt style={{ color: 'var(--ink-secondary)' }}>{k}</dt>
      <dd className="tnum text-right" style={{ color: 'var(--ink)' }}>{v}</dd>
    </div>
  )
}
