/**
 * DayLogForm — the check-in, for any date.
 *
 * Today's check-in and "fix a past day" are the same form. It pre-fills from
 * whatever the day already holds, and all save rules live in dayLog.ts (pure,
 * tested), so this file is only presentation.
 *
 * Deliberately light: bleeding, pain, symptom chips, impact, medication. Severity
 * per symptom, the impact follow-up and notes appear only when relevant.
 */

import { useMemo, useState } from 'react'
import { planDailyQuestions } from '../../engine/adaptive'
import { getSymptom, symptomLabel, SYMPTOMS } from '../../engine/symptoms'
import type { FeatureContext } from '../../engine/features'
import { BLEEDING_LEVELS, ImpactLevel, type BleedingLevel, type DayRecord } from '../../engine/types'
import { isFutureDate } from '../../lib/dates'
import { useData } from '../data'
import { buildDayRecord, draftFromDay, PRIMARY_PAIN, type DayLogDraft } from './dayLog'

const BLEED_LABEL: Record<BleedingLevel, string> = {
  none: 'None',
  spotting: 'Spotting',
  light: 'Light',
  moderate: 'Moderate',
  heavy: 'Heavy',
  very_heavy: 'Very heavy',
}

const IMPACT_CHOICES: { level: ImpactLevel; label: string }[] = [
  { level: ImpactLevel.None, label: 'No' },
  { level: ImpactLevel.Slight, label: 'A little' },
  { level: ImpactLevel.ModifiedActivities, label: 'Changed my plans' },
  { level: ImpactLevel.CouldNotPerform, label: 'Couldn’t do something important' },
]

const IMPACT_DOMAINS = ['Work', 'Education', 'Exercise', 'Sleep', 'Household', 'Social', 'Concentration', 'Mood']
const DEFAULT_MEDS = ['Ibuprofen', 'Paracetamol', 'Mefenamic acid']

export function DayLogForm({
  date,
  ctx,
  onSaved,
  onCleared,
}: {
  date: string
  ctx: FeatureContext
  onSaved?: () => void
  onCleared?: () => void
}) {
  const { record, customLabels, today, saveDay, clearDay, repo, mode } = useData()
  const existing = useMemo(() => record.days.find((d) => d.date === date), [record.days, date])

  // Suggested chips: the adaptive plan for this date, plus anything already
  // recorded as present that day, so an edit shows what the day actually holds.
  const shownIds = useMemo(() => {
    const plan = planDailyQuestions(ctx, date)
    const ids = plan.surfaced.map((q) => q.symptomId).filter((id) => id !== PRIMARY_PAIN)
    for (const [id, obs] of Object.entries(existing?.symptoms ?? {})) {
      if (id !== PRIMARY_PAIN && obs.state === 'present' && !ids.includes(id)) ids.push(id)
    }
    return ids
  }, [ctx, date, existing])

  const phaseLinked = useMemo(
    () => new Set(planDailyQuestions(ctx, date).surfaced.filter((q) => q.reason === 'cycle_phase').map((q) => q.symptomId)),
    [ctx, date],
  )

  const [draft, setDraft] = useState<DayLogDraft>(() => draftFromDay(existing, shownIds))
  const [showMore, setShowMore] = useState(false)
  const [showRate, setShowRate] = useState(false)
  const [showNote, setShowNote] = useState(Boolean(existing?.note))
  const [customLabel, setCustomLabel] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [confirmClear, setConfirmClear] = useState(false)

  const future = isFutureDate(date, today)
  const update = (patch: Partial<DayLogDraft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setStatus('idle')
  }

  const toggle = (id: string) => {
    setDraft((d) => {
      const selected = new Set(d.selected)
      const cleared = new Set(d.explicitlyCleared)
      if (selected.has(id)) {
        selected.delete(id)
        cleared.add(id) // tapped then untapped: asked, answer is no
      } else {
        selected.add(id)
        cleared.delete(id)
      }
      return { ...d, selected, explicitlyCleared: cleared }
    })
    setStatus('idle')
  }

  async function save() {
    setStatus('saving')
    const day = buildDayRecord(date, { ...draft, shown: shownIds }, existing)
    await saveDay(day)
    setStatus('saved')
    onSaved?.()
  }

  async function clear() {
    await clearDay(date)
    setConfirmClear(false)
    onCleared?.()
  }

  async function addOwnSymptom() {
    if (!repo || !customLabel.trim()) return
    const key = await repo.addCustomSymptom(customLabel)
    setCustomLabel('')
    toggle(key)
  }

  if (future) {
    return (
      <p className="notice notice-info">
        This day hasn’t happened yet. You can log it once it has.
      </p>
    )
  }

  const selectedGraded = [...draft.selected].filter(
    (id) => id !== PRIMARY_PAIN && getSymptom(id)?.graded !== false,
  )

  const otherSymptoms = [
    ...SYMPTOMS.filter((s) => !shownIds.includes(s.id) && s.id !== PRIMARY_PAIN && (!s.sensitive || record.profile.enabledDomains.includes('sexual'))),
    ...Object.entries(customLabels)
      .filter(([id]) => !shownIds.includes(id))
      .map(([id, label]) => ({ id, label })),
  ]

  const medOptions = [
    ...new Set([
      ...DEFAULT_MEDS,
      ...record.days.flatMap((d) => d.medications?.map((m) => m.label) ?? []),
      ...draft.medications,
    ]),
  ].slice(0, 8)

  return (
    <div>
      {/* Bleeding */}
      <Section label="Bleeding">
        <div className="flex flex-wrap gap-2">
          {BLEEDING_LEVELS.map((lvl) => (
            <button key={lvl} type="button" className="chip focus-ring" data-selected={draft.bleeding === lvl}
              onClick={() => update({ bleeding: lvl })}>
              {lvl !== 'none' && (
                <span aria-hidden style={{
                  width: 9, height: 9, borderRadius: 999, flexShrink: 0,
                  background: `color-mix(in srgb, var(--bleed) ${20 + BLEEDING_LEVELS.indexOf(lvl) * 18}%, transparent)`,
                  border: '1px solid var(--bleed)',
                }} />
              )}
              {BLEED_LABEL[lvl]}
            </button>
          ))}
        </div>
      </Section>

      {/* Pain */}
      <Section label="Pelvic pain">
        <div className="flex items-center gap-4">
          <input type="range" min={0} max={10} value={draft.pain}
            onChange={(e) => update({ pain: Number(e.target.value) })}
            className="focus-ring h-2 flex-1" style={{ accentColor: 'var(--ink)' }}
            aria-label="Pelvic pain, 0 to 10" />
          <span className="display tnum" style={{ fontSize: 30, minWidth: 40, textAlign: 'right' }}>
            {draft.pain}
          </span>
        </div>
      </Section>

      {/* Symptoms */}
      <Section label="Anything else?">
        <div className="flex flex-wrap gap-2">
          {shownIds.map((id) => (
            <button key={id} type="button" className="chip focus-ring" data-selected={draft.selected.has(id)}
              onClick={() => toggle(id)}
              title={phaseLinked.has(id) ? 'Suggested because it often appears around your period' : undefined}>
              {symptomLabel(id, customLabels)}
              {typeof draft.severities[id] === 'number' && draft.selected.has(id) && (
                <span className="tnum text-[12px] opacity-70">{draft.severities[id]}</span>
              )}
              {phaseLinked.has(id) && (
                <span aria-hidden style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--bleed)' }} />
              )}
            </button>
          ))}
          {[...draft.selected]
            .filter((id) => id !== PRIMARY_PAIN && !shownIds.includes(id))
            .map((id) => (
              <button key={id} type="button" className="chip focus-ring" data-selected onClick={() => toggle(id)}>
                {symptomLabel(id, customLabels)}
              </button>
            ))}
          <button type="button" className="chip focus-ring" style={{ borderStyle: 'dashed' }}
            onClick={() => setShowMore((v) => !v)}>
            {showMore ? 'Close' : '+ Add another'}
          </button>
        </div>

        {showMore && (
          <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--surface-sunken)' }}>
            <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
              {otherSymptoms
                .filter((s) => !draft.selected.has(s.id))
                .map((s) => (
                  <button key={s.id} type="button" className="chip focus-ring"
                    style={{ minHeight: 36, fontSize: 13 }} onClick={() => toggle(s.id)}>
                    {s.label}
                  </button>
                ))}
            </div>
            {mode === 'account' && (
              <div className="mt-3 flex gap-2">
                <input className="input" style={{ minHeight: 40 }} placeholder="Describe it in your own words"
                  value={customLabel} maxLength={60} onChange={(e) => setCustomLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addOwnSymptom() } }} />
                <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 40, paddingInline: 14 }}
                  onClick={() => void addOwnSymptom()} disabled={!customLabel.trim()}>
                  Add
                </button>
              </div>
            )}
          </div>
        )}

        {selectedGraded.length > 0 && (
          <div className="mt-3">
            <button type="button" className="link text-[13px]" onClick={() => setShowRate((v) => !v)}>
              {showRate ? 'Hide severity' : 'Rate how bad (optional)'}
            </button>
            {showRate && (
              <div className="mt-2 space-y-2.5">
                {selectedGraded.map((id) => (
                  <div key={id}>
                    <div className="mb-1 flex justify-between text-[13px]">
                      <span style={{ color: 'var(--ink-secondary)' }}>{symptomLabel(id, customLabels)}</span>
                      {typeof draft.severities[id] === 'number' && (
                        <button type="button" className="text-[12px]" style={{ background: 'none', border: 'none', color: 'var(--ink-muted)' }}
                          onClick={() => {
                            const s = { ...draft.severities }
                            delete s[id]
                            update({ severities: s })
                          }}>
                          clear
                        </button>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
                        <button key={v} type="button" onClick={() => update({ severities: { ...draft.severities, [id]: v } })}
                          className="focus-ring tnum flex-1 rounded-md text-[12px]"
                          style={{
                            minHeight: 32,
                            border: '1px solid var(--hairline-strong)',
                            background: draft.severities[id] === v ? 'var(--ink)' : 'var(--surface)',
                            color: draft.severities[id] === v ? 'var(--ground)' : 'var(--ink-secondary)',
                          }}>
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Impact */}
      <Section label={date === today ? 'Did symptoms get in the way today?' : 'Did symptoms get in the way that day?'}>
        <div className="flex flex-wrap gap-2">
          {IMPACT_CHOICES.map((c) => (
            <button key={c.level} type="button" className="chip focus-ring" data-selected={draft.impact === c.level}
              onClick={() => update({ impact: draft.impact === c.level ? null : c.level })}>
              {c.label}
            </button>
          ))}
        </div>
        {draft.impact !== null && draft.impact >= ImpactLevel.ModifiedActivities && (
          <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--amber-soft)' }}>
            <p className="mb-2 text-[13px] font-medium">What was affected?</p>
            <div className="flex flex-wrap gap-1.5">
              {IMPACT_DOMAINS.map((d) => {
                const key = d.toLowerCase()
                return (
                  <button key={d} type="button" className="chip focus-ring" style={{ minHeight: 36, fontSize: 13 }}
                    data-selected={draft.impactDomains.includes(key)}
                    onClick={() => update({
                      impactDomains: draft.impactDomains.includes(key)
                        ? draft.impactDomains.filter((x) => x !== key)
                        : [...draft.impactDomains, key],
                    })}>
                    {d}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </Section>

      {/* Medication */}
      <Section label="Medication">
        <div className="flex flex-wrap gap-2">
          {medOptions.map((m) => (
            <button key={m} type="button" className="chip focus-ring" data-selected={draft.medications.includes(m)}
              onClick={() => update({
                medications: draft.medications.includes(m)
                  ? draft.medications.filter((x) => x !== m)
                  : [...draft.medications, m],
              })}>
              {m}
            </button>
          ))}
          <button type="button" className="chip focus-ring" data-selected={draft.medications.length === 0}
            onClick={() => update({ medications: [] })}>
            None
          </button>
        </div>
      </Section>

      {/* Note */}
      <div className="mt-5">
        {showNote ? (
          <>
            <label className="field-label" htmlFor={`note-${date}`}>Note</label>
            <textarea id={`note-${date}`} className="input" maxLength={2000} value={draft.note}
              placeholder="Anything worth remembering about today"
              onChange={(e) => update({ note: e.target.value })} />
          </>
        ) : (
          <button type="button" className="link text-[13.5px]" onClick={() => setShowNote(true)}>
            + Add a note
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} className="btn btn-primary focus-ring" disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving…' : existing ? 'Save changes' : 'Save'}
        </button>
        {status === 'saved' && (
          <span className="text-[13.5px]" style={{ color: 'var(--sage)' }} role="status">
            Saved{mode === 'account' ? '' : ' (demo — stays in this browser)'}
          </span>
        )}
        {existing && !confirmClear && (
          <button type="button" className="btn btn-ghost focus-ring ml-auto" style={{ minHeight: 40 }}
            onClick={() => setConfirmClear(true)}>
            Clear this day
          </button>
        )}
      </div>

      {confirmClear && (
        <div className="notice notice-info mt-4">
          <p>
            Clear everything logged for this day? It will count as <strong>not logged</strong> — not as a
            day without symptoms. Earlier versions are kept in your history.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-danger focus-ring" style={{ minHeight: 40 }} onClick={clear}>
              Clear day
            </button>
            <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 40 }} onClick={() => setConfirmClear(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <p className="mb-2.5 text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>{label}</p>
      {children}
    </div>
  )
}
