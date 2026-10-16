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
import { useAnalysis, useCustomLabels, useData, useRecord } from '../data'
import { SharePanel } from '../share/SharePanel'
import { buildShareSnapshot, OWN_COPY_PRIVACY, SHARE_SECTIONS, summarySentences } from '../share/snapshot'
import { backgroundLines } from '../share/background'
import { BackgroundList } from '../share/SharedReportView'
import { summariseClaims } from '../../data/aiAssist'
import { claimsKey, useCurrentSummary, useSummaryStore } from '../summaryStore'
import { deliverFile } from '../../native/files'
import { isNative } from '../../native/platform'
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
  const { ctx, brief, verifiedClaims } = useAnalysis()
  const record = useRecord()
  const customLabels = useCustomLabels()
  const { mode, reportLabels } = useData()
  const [openClaim, setOpenClaim] = useState<Claim | null>(null)
  const summary = useCurrentSummary(verifiedClaims)

  // Browsers print the styled page; inside the Android WebView print() does
  // nothing, so phones get a generated PDF handed to the share sheet. The PDF is
  // built from the same snapshot a share link uses, with every section included
  // because this is the patient's own copy.
  async function printOrShare() {
    if (!isNative) {
      window.print()
      return
    }
    const snapshot = buildShareSnapshot({
      claims: verifiedClaims,
      record,
      window: {
        start: ctx.window.start,
        end: ctx.window.end,
        loggedDays: ctx.loggedDays,
        calendarDays: ctx.calendarDays,
        completeCycles: ctx.windowCycles.filter((c) => c.complete).length,
      },
      concerns: mainConcerns(ctx, 4, reportLabels),
      selected: new Set(SHARE_SECTIONS.map((s) => s.id)),
      // Her own download: the full report, name included. Privacy choices apply to share links.
      privacy: OWN_COPY_PRIVACY,
      summary: summary ?? undefined,
    })
    // Loaded on demand: the PDF library is large and only phones use this path.
    const { buildReportPdf } = await import('../share/reportPdf')
    await deliverFile(`medtrace-report-${ctx.window.end}.pdf`, buildReportPdf(snapshot), 'MedTrace report')
  }

  const concerns = useMemo(() => mainConcerns(ctx, 4, reportLabels), [ctx, reportLabels])
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
              {[
                record.profile.displayName,
                record.profile.ageRange,
                record.profile.diagnosisStatus === 'confirmed'
                  ? 'Endometriosis confirmed'
                  : record.profile.diagnosisStatus === 'suspected'
                    ? 'Suspected endometriosis'
                    : 'Not yet diagnosed',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <button
            onClick={() => void printOrShare()}
            className="no-print focus-ring rounded-full px-4 py-2 text-[13px] font-medium"
            style={{ border: '1px solid var(--hairline-strong)', background: 'transparent', color: 'var(--ink-secondary)' }}
          >
            {isNative ? 'Save as PDF' : 'Print / PDF'}
          </button>
        </div>

        {mode === 'account' && (
          <AiSummary claims={verifiedClaims} rewrites={summary} onOpen={setOpenClaim} />
        )}

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
              value={cycleSummary.medianLength ? `${cycleSummary.medianLength}d (${cycleSummary.minLength}–${cycleSummary.maxLength})` : '-'}
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

        {/* --- Background --- */}
        {(() => {
          const lines = backgroundLines(record.profile, { fertility: true })
          return lines.length > 0 ? (
            <Section title="Background">
              <BackgroundList lines={lines} />
            </Section>
          ) : null
        })()}

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
                      {e.reason && <span style={{ color: 'var(--ink-secondary)' }}>: {e.reason}</span>}
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
        {mode === 'account' && <SharePanel />}
      </aside>

      {openClaim && (
        <EvidenceDrawer claim={openClaim} onClose={() => setOpenClaim(null)} labels={customLabels} />
      )}
    </div>
  )
}

/**
 * Plain-language summary, written by AI on request. Each sentence is the AI's
 * rewrite of one checked claim and has passed verifySummarySentence; one that
 * failed keeps the original wording. Every sentence still opens its evidence.
 */
function AiSummary({
  claims, rewrites, onOpen,
}: {
  claims: Claim[]
  rewrites: Record<string, string> | null
  onOpen: (c: Claim) => void
}) {
  const setSummary = useSummaryStore((s) => s.set)
  const clearSummary = useSummaryStore((s) => s.clear)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const candidates = summarySentences(claims, {}).map((s) => s.claim)

  async function write() {
    setBusy(true)
    setFailed(false)
    const result = await summariseClaims(candidates)
    setBusy(false)
    if (!result || Object.keys(result).length === 0) return setFailed(true)
    setSummary(claimsKey(claims), result)
  }

  if (candidates.length === 0) return null

  if (!rewrites) {
    return (
      <div className="no-print mt-5 rounded-xl p-4" style={{ background: 'var(--surface-sunken)' }}>
        <p className="text-[13.5px] font-semibold">Summary in plain words</p>
        <p className="mt-1 text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
          An AI can reword the findings below so they’re quicker to read. It only sees these finished
          sentences, and every number it writes is checked against your logs before it’s shown.
        </p>
        <button type="button" className="btn btn-ghost focus-ring mt-3" style={{ minHeight: 40 }}
          disabled={busy} onClick={() => void write()}>
          {busy ? 'Writing… (can take a minute)' : 'Write a summary with AI'}
        </button>
        {failed && (
          <p className="mt-2 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
            Couldn’t write a summary. AI help may be off (Me → Your data), or you may be offline.
          </p>
        )}
      </div>
    )
  }

  const sentences = summarySentences(claims, rewrites)
  const reworded = sentences.filter((s) => s.rewritten).length
  return (
    <Section title="Summary in plain words">
      <p className="text-[14.5px] leading-relaxed">
        {sentences.map((s) => (
          <button key={s.claim.id} type="button" onClick={() => onOpen(s.claim)}
            className="focus-ring inline rounded text-left"
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--ink)', borderBottom: '1px dotted var(--hairline-strong)' }}
            title="Show the evidence behind this sentence">
            {s.text}
          </button>
        )).flatMap((el, i) => (i === 0 ? [el] : [' ', el]))}
      </p>
      <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
        Written by AI from the findings below: {reworded} of {sentences.length} sentences reworded. Every number was
        checked against your logs; a sentence that failed the check keeps its original wording.
        <button type="button" className="link no-print ml-2 text-[11.5px]" onClick={clearSummary}>Remove</button>
      </p>
    </Section>
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

        <p className="mt-3 inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--viz-good)' }} />
          Every number in this sentence was checked again against the logged days.
        </p>
        {finding && (
          <p className="mt-2 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
            Based on {finding.observedDays} logged days ({pct(finding.coverage)}% of days in this period).
          </p>
        )}

        {claim.evidenceDates.length > 0 && (
          <div className="mt-5">
            <H>Days behind this ({claim.evidenceDates.length})</H>
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
                          ? aligned.signedCycleDay === 0
                            ? 'first day of period'
                            : aligned.signedCycleDay > 0
                              ? `${aligned.signedCycleDay} day${aligned.signedCycleDay === 1 ? '' : 's'} after period started`
                              : `${-aligned.signedCycleDay} day${aligned.signedCycleDay === -1 ? '' : 's'} before period`
                          : ''}
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
