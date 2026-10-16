/**
 * Onboarding — four short steps, most of them skippable.
 *
 *   1. Consent, per purpose, against a versioned notice (DPDP). Core tracking is
 *      required to use the app; every other purpose is off by default.
 *   2. A little context — all optional, collected "gradually" per the design doc.
 *   3. Which symptoms to track — these become the first daily chips.
 *   4. Reminders — generic wording only, never naming a symptom.
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DEFAULT_TRACKED_SYMPTOMS, SYMPTOMS } from '../../engine/symptoms'
import type { SymptomDomain } from '../../engine/types'
import { useData } from '../data'
import { requestReminderPermission } from '../../native/reminders'
import { CONSENT_PURPOSES, NOTICE_VERSION } from '../privacy'
import { Wordmark } from './auth/AuthLayout'
import { Check } from './auth/Register'
import { PrivacyDialog } from '../PrivacyDialog'

type Step = 'consent' | 'about' | 'symptoms' | 'reminders'
const STEPS: Step[] = ['consent', 'about', 'symptoms', 'reminders']

export default function Onboarding() {
  const { repo } = useData()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('consent')
  const [busy, setBusy] = useState(false)

  // Consent
  const [consents, setConsents] = useState<Record<string, boolean>>({
    core_tracking: false,
    sexual_health_module: false,
    fertility_module: false,
    research_use: false,
    ai_symptom_wording: false,
  })
  const [showNotice, setShowNotice] = useState(false)

  // About you
  const [displayName, setDisplayName] = useState('')
  const [status, setStatus] = useState<'suspected' | 'confirmed' | 'undiagnosed'>('suspected')
  const [onsetYear, setOnsetYear] = useState('')
  const [cycle, setCycle] = useState<'regular' | 'variable' | 'highly_irregular' | ''>('')

  // Symptoms
  const [tracked, setTracked] = useState<string[]>(DEFAULT_TRACKED_SYMPTOMS)

  // Reminders
  const [reminder, setReminder] = useState<'daily' | 'period' | 'none'>('daily')

  const enabledDomains = useMemo<SymptomDomain[]>(() => {
    const d: SymptomDomain[] = ['pain', 'bowel', 'urinary', 'systemic']
    if (consents.sexual_health_module) d.push('sexual')
    return d
  }, [consents.sexual_health_module])

  const index = STEPS.indexOf(step)
  const next = () => setStep(STEPS[Math.min(index + 1, STEPS.length - 1)])
  const back = () => setStep(STEPS[Math.max(index - 1, 0)])

  async function finish() {
    if (!repo) return
    setBusy(true)
    for (const p of CONSENT_PURPOSES) {
      await repo.recordConsent(p.id, Boolean(consents[p.id]), NOTICE_VERSION)
    }
    const year = Number(onsetYear)
    await repo.updateProfile({
      display_name: displayName.trim() || null,
      diagnosis_status: status,
      symptom_onset_year: Number.isInteger(year) && year >= 1950 && year <= new Date().getFullYear() ? year : null,
      cycle_regularity: cycle || null,
      enabled_domains: enabledDomains,
      tracked_symptom_ids: tracked,
      reminder,
      onboarded_at: new Date().toISOString(),
    })
    await repo.audit('onboarding_completed')
    // Ask for notification permission at the moment it makes sense, not on launch.
    if (reminder !== 'none') await requestReminderPermission().catch(() => false)
    setBusy(false)
    navigate('/today', { replace: true })
  }

  const visibleSymptoms = SYMPTOMS.filter(
    (s) => !s.rare && (!s.sensitive || consents.sexual_health_module),
  )

  return (
    <div className="safe-top mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 pb-10 pt-8">
      <div className="flex items-center justify-between">
        <Wordmark size={20} />
        <span className="text-[12.5px] tnum" style={{ color: 'var(--ink-muted)' }}>
          {index + 1} of {STEPS.length}
        </span>
      </div>

      <div className="mt-3 flex gap-1.5" aria-hidden>
        {STEPS.map((s, i) => (
          <span
            key={s}
            className="h-1 flex-1 rounded-full"
            style={{ background: i <= index ? 'var(--ink)' : 'var(--hairline)' }}
          />
        ))}
      </div>

      <div className="mt-8 flex-1">
        {step === 'consent' && (
          <>
            <h1 style={{ fontSize: 28 }}>Before you start</h1>
            <p className="mt-2 text-[14.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              Choose what MedTrace can do. You can change this later in Me.{' '}
              <button type="button" className="link" style={{ background: 'none', border: 'none', padding: 0 }}
                onClick={() => setShowNotice(true)}>
                Privacy notice
              </button>
            </p>
            <PrivacyDialog open={showNotice} onClose={() => setShowNotice(false)} />
            <div className="mt-6 space-y-3">
              {CONSENT_PURPOSES.map((p) => (
                <div key={p.id} className="card p-4">
                  <Check
                    checked={consents[p.id]}
                    onChange={(v) => setConsents((c) => ({ ...c, [p.id]: v }))}
                  >
                    <span className="block text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
                      {p.title}
                      {p.required && (
                        <span className="ml-2 text-[11.5px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                          needed to use the app
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-[13.5px]">{p.body}</span>
                  </Check>
                </div>
              ))}
            </div>
          </>
        )}

        {step === 'about' && (
          <>
            <h1 style={{ fontSize: 28 }}>A little context</h1>
            <p className="mt-2 text-[14.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              All optional. It helps your report read clearly to a clinician.
            </p>

            <div className="mt-6">
              <label className="field-label" htmlFor="display-name">
                Name to show on your report
              </label>
              <input
                id="display-name"
                className="input"
                maxLength={60}
                autoComplete="given-name"
                placeholder="Optional. A first name is enough"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>

            <fieldset className="mt-6">
              <legend className="field-label">Where are you with a diagnosis?</legend>
              <div className="flex flex-col gap-2">
                {([
                  ['suspected', 'I think it might be endometriosis'],
                  ['confirmed', 'Endometriosis has been confirmed'],
                  ['undiagnosed', 'I’m not sure what’s causing my symptoms'],
                ] as const).map(([v, label]) => (
                  <Choice key={v} selected={status === v} onClick={() => setStatus(v)}>
                    {label}
                  </Choice>
                ))}
              </div>
            </fieldset>

            <div className="mt-6">
              <label className="field-label" htmlFor="onset">
                Roughly what year did symptoms start?
              </label>
              <input
                id="onset"
                className="input"
                inputMode="numeric"
                placeholder="e.g. 2019"
                value={onsetYear}
                onChange={(e) => setOnsetYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </div>

            <fieldset className="mt-6">
              <legend className="field-label">Are your cycles usually…</legend>
              <div className="flex flex-wrap gap-2">
                {([
                  ['regular', 'Regular'],
                  ['variable', 'Somewhat variable'],
                  ['highly_irregular', 'Very irregular'],
                ] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    className="chip focus-ring"
                    data-selected={cycle === v}
                    onClick={() => setCycle(cycle === v ? '' : v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
          </>
        )}

        {step === 'symptoms' && (
          <>
            <h1 style={{ fontSize: 28 }}>What do you want to track?</h1>
            <p className="mt-2 text-[14.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              These become your quick-tap options each day. You can add anything else, including
              symptoms in your own words, whenever it happens.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {visibleSymptoms.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="chip focus-ring"
                  data-selected={tracked.includes(s.id)}
                  onClick={() =>
                    setTracked((t) => (t.includes(s.id) ? t.filter((x) => x !== s.id) : [...t, s.id]))
                  }
                >
                  {s.label}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'reminders' && (
          <>
            <h1 style={{ fontSize: 28 }}>Gentle reminders</h1>
            <p className="mt-2 text-[14.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              Reminders only ever say “Your check-in is ready”, never the name of a symptom. No
              streaks, and no messages about days you missed.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              {([
                ['daily', 'Every day', 'The most complete record'],
                ['period', 'Only around my period', 'Fewer reminders, focused on the days that matter most'],
                ['none', 'No reminders', 'I’ll open the app myself'],
              ] as const).map(([v, label, sub]) => (
                <Choice key={v} selected={reminder === v} onClick={() => setReminder(v)}>
                  <span className="block font-semibold">{label}</span>
                  <span className="block text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                    {sub}
                  </span>
                </Choice>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="mt-8 flex gap-3">
        {index > 0 && (
          <button className="btn btn-ghost focus-ring" onClick={back} disabled={busy}>
            Back
          </button>
        )}
        {step !== 'reminders' ? (
          <button
            className="btn btn-primary focus-ring flex-1"
            onClick={next}
            disabled={step === 'consent' && !consents.core_tracking}
          >
            Continue
          </button>
        ) : (
          <button className="btn btn-primary focus-ring flex-1" onClick={finish} disabled={busy}>
            {busy ? 'Setting up…' : 'Start tracking'}
          </button>
        )}
      </div>
      {step === 'consent' && !consents.core_tracking && (
        <p className="mt-3 text-center text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          “Keep my symptom record” is needed for the app to work.
        </p>
      )}
    </div>
  )
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="focus-ring flex items-center gap-3 rounded-xl px-4 py-3 text-left text-[14.5px]"
      style={{
        border: `1px solid ${selected ? 'var(--ink)' : 'var(--hairline-strong)'}`,
        background: selected ? 'var(--surface-sunken)' : 'var(--surface)',
        color: 'var(--ink)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 16, height: 16, borderRadius: 999, flexShrink: 0,
          border: `2px solid ${selected ? 'var(--ink)' : 'var(--hairline-strong)'}`,
          background: selected ? 'var(--ink)' : 'transparent',
        }}
      />
      <span>{children}</span>
    </button>
  )
}
