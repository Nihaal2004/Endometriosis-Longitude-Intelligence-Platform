/**
 * DayLogForm — the check-in, for any date.
 *
 * Today's check-in and "fix a past day" are the same form. It pre-fills from
 * whatever the day already holds, and all save rules live in dayLog.ts (pure,
 * tested), so this file is only presentation.
 *
 * Two modes, remembered per device. Quick: bleeding, pain, symptom chips and a
 * note. Detailed adds severity per symptom, impact and medication. A question
 * quick mode skips is saved as unknown, never as "no", and anything a day already
 * holds is kept when it is re-saved in quick mode. The note box is always open.
 */

import { useMemo, useRef, useState } from 'react'
import { planDailyQuestions } from '../../engine/adaptive'
import { clinicalLabel, getSymptom, symptomLabel, SYMPTOMS } from '../../engine/symptoms'
import type { FeatureContext } from '../../engine/features'
import { BLEEDING_LEVELS, ImpactLevel, type BleedingLevel, type DayRecord } from '../../engine/types'
import { interpretSymptom, type CatalogEntry, type Interpretation } from '../../data/interpret'
import { interpretDay, type DayInterpretation } from '../../data/aiAssist'
import { isFutureDate } from '../../lib/dates'
import { useData } from '../data'
import { useApp, type LogMode } from '../store'
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

/** What a bad day got in the way of. Keys are stored; sexual activity is offered only with that module on. */
export const IMPACT_DOMAINS: { key: string; label: string; sensitive?: boolean }[] = [
  { key: 'work', label: 'Work' },
  { key: 'education', label: 'Education' },
  { key: 'exercise', label: 'Exercise' },
  { key: 'walking', label: 'Walking / getting around' },
  { key: 'sleep', label: 'Sleep' },
  { key: 'household', label: 'Household' },
  { key: 'social', label: 'Social' },
  { key: 'concentration', label: 'Concentration' },
  { key: 'mood', label: 'Mood' },
  { key: 'sexual activity', label: 'Sexual activity', sensitive: true },
]
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
  const { record, customLabels, customTerms, today, saveDay, clearDay, repo, mode } = useData()
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
  const [customLabel, setCustomLabel] = useState('')
  const [interpreting, setInterpreting] = useState(false)
  const [suggestion, setSuggestion] = useState<{ label: string; result: Interpretation } | null>(null)
  const [reading, setReading] = useState(false)
  const [understood, setUnderstood] = useState<DayInterpretation | null>(null)
  const [readFailed, setReadFailed] = useState(false)
  const [filled, setFilled] = useState(false)
  const top = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [confirmClear, setConfirmClear] = useState(false)
  const logMode = useApp((s) => s.logMode)
  const setLogMode = useApp((s) => s.setLogMode)
  const detailed = logMode === 'detailed'

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

  // What the patient's words may be matched against: everything they could pick
  // here, minus the pain slider's own symptom and any domain they have not enabled.
  const catalog = useMemo<CatalogEntry[]>(() => [
    ...SYMPTOMS
      .filter((s) => s.id !== PRIMARY_PAIN && (!s.sensitive || record.profile.enabledDomains.includes('sexual')))
      .map((s) => ({ id: s.id, label: s.label, clinicalTerm: s.clinicalTerm })),
    ...Object.entries(customLabels).map(([id, label]) => ({ id, label, clinicalTerm: customTerms[id] })),
  ], [record.profile.enabledDomains, customLabels, customTerms])

  const select = (id: string) => {
    if (!draft.selected.has(id)) toggle(id)
  }

  /** Offer a clinical term when the patient has consented; otherwise (or on any failure) keep their words as typed. */
  async function addOwnSymptom() {
    const label = customLabel.trim()
    if (!repo || !label || interpreting) return
    setInterpreting(true)
    const result = await interpretSymptom(label, catalog)
    setInterpreting(false)
    if (result) setSuggestion({ label, result })
    else await saveOwnSymptom(label)
  }

  async function saveOwnSymptom(label: string, result?: Interpretation) {
    if (!repo) return
    const term = result?.match === 'new' ? result.clinicalTerm : null
    const key = await repo.addCustomSymptom(label, result?.domain, result?.graded, term)
    setCustomLabel('')
    setSuggestion(null)
    select(key)
  }

  function pickCatalogMatch(id: string) {
    setCustomLabel('')
    setSuggestion(null)
    select(id)
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

  const areaOptions = IMPACT_DOMAINS.filter((d) => !d.sensitive || record.profile.enabledDomains.includes('sexual'))

  /** Ask the AI to read the note; nothing changes until she taps "Fill it in". */
  async function readNote() {
    setReading(true)
    setReadFailed(false)
    setFilled(false)
    const result = await interpretDay(draft.note, catalog, medOptions, areaOptions.map((a) => a.key))
    setReading(false)
    setUnderstood(result)
    setReadFailed(result === null)
  }

  /** Fill only what the AI found; everything else stays as she left it. Never saves. */
  function fillFromNote(r: DayInterpretation) {
    setDraft((d) => {
      const selected = new Set(d.selected)
      const cleared = new Set(d.explicitlyCleared)
      for (const id of r.symptomIds) {
        selected.add(id)
        cleared.delete(id)
      }
      return {
        ...d,
        bleeding: r.bleeding ?? d.bleeding,
        pain: r.pain ?? d.pain,
        selected,
        explicitlyCleared: cleared,
        impact: r.impact ?? d.impact,
        impactDomains: r.areas.length > 0 ? r.areas : d.impactDomains,
        medications: [...new Set([...d.medications, ...r.medications])],
      }
    })
    // Impact and medication only show in Detailed, and she should see what will be saved.
    if (r.impact !== null || r.medications.length > 0) setLogMode('detailed')
    setUnderstood(null)
    setFilled(true)
    setStatus('idle')
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div ref={top}>
      {filled && (
        <p className="notice notice-info mb-5" role="status">
          Filled in from your note. Check everything below, change anything that’s wrong, then save.
        </p>
      )}
      {/* Mode */}
      <div className="mb-6">
        <div className="segmented" role="tablist" aria-label="How much to log">
          {(['quick', 'detailed'] as LogMode[]).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={logMode === m} className="focus-ring"
              onClick={() => setLogMode(m)}>
              {m === 'quick' ? 'Quick' : 'Detailed'}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          {detailed
            ? 'Also asks how bad each symptom was, what it got in the way of, and any medication.'
            : 'Just the basics, about 20 seconds. Switch to Detailed any time for more.'}
        </p>
      </div>

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
                  value={customLabel} maxLength={60} disabled={interpreting || suggestion !== null}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addOwnSymptom() } }} />
                <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 40, paddingInline: 14 }}
                  onClick={() => void addOwnSymptom()} disabled={!customLabel.trim() || interpreting || suggestion !== null}>
                  {interpreting ? 'Checking…' : 'Add'}
                </button>
              </div>
            )}
            {suggestion && (
              <SuggestionCard
                label={suggestion.label}
                result={suggestion.result}
                customLabels={customLabels}
                onAccept={() => {
                  const r = suggestion.result
                  if (r.match === 'catalog') pickCatalogMatch(r.catalogId)
                  else void saveOwnSymptom(suggestion.label, r)
                }}
                onDecline={() => void saveOwnSymptom(suggestion.label)}
              />
            )}
          </div>
        )}

        {detailed && selectedGraded.length > 0 && (
          <div className="mt-3">
            <p className="text-[13px] font-medium" style={{ color: 'var(--ink-secondary)' }}>How bad? (optional)</p>
            {(
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

      {detailed && (<>
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
              {IMPACT_DOMAINS.filter((d) => !d.sensitive || record.profile.enabledDomains.includes('sexual')).map((d) => {
                const key = d.key
                return (
                  <button key={key} type="button" className="chip focus-ring" style={{ minHeight: 36, fontSize: 13 }}
                    data-selected={draft.impactDomains.includes(key)}
                    onClick={() => update({
                      impactDomains: draft.impactDomains.includes(key)
                        ? draft.impactDomains.filter((x) => x !== key)
                        : [...draft.impactDomains, key],
                    })}>
                    {d.label}
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
      </>)}

      {/* Note: always open, because a collapsed "Add a note" link was easy to miss */}
      <div className="mt-5">
        <label className="field-label" htmlFor={`note-${date}`}>How was today? (optional)</label>
        <textarea id={`note-${date}`} className="input" maxLength={2000} value={draft.note}
          placeholder="Type it like a text, e.g. ‘cramps woke me up, skipped class, felt really low tonight’"
          onChange={(e) => { update({ note: e.target.value }); setUnderstood(null); setReadFailed(false) }} />
        {mode === 'account' && (
          <button type="button" className="btn btn-ghost focus-ring mt-2" style={{ minHeight: 40 }}
            disabled={draft.note.trim().length < 10 || reading}
            onClick={() => void readNote()}>
            {reading ? 'Reading your note…' : 'Fill in the form for me'}
          </button>
        )}
        {readFailed && (
          <p className="mt-2 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
            Couldn’t fill it in from your note. AI help may be off (Me → Your data), or you may be offline.
            Your note is still here; fill in the form above yourself.
          </p>
        )}
        {understood && (
          <UnderstoodCard result={understood} customLabels={customLabels} areas={areaOptions}
            onUse={() => fillFromNote(understood)} onDismiss={() => setUnderstood(null)} />
        )}
      </div>

      {/* Actions */}
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} className="btn btn-primary focus-ring" disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving…' : existing ? 'Save changes' : 'Save'}
        </button>
        {status === 'saved' && (
          <span className="text-[13.5px]" style={{ color: 'var(--sage)' }} role="status">
            Saved{mode === 'account' ? '' : ' (demo, stays in this browser)'}
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
            Clear everything logged for this day? It will count as <strong>not logged</strong>, not as a
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

/** "I understood this": what the AI read from her note, before anything changes. */
function UnderstoodCard({
  result, customLabels, areas, onUse, onDismiss,
}: {
  result: DayInterpretation
  customLabels: Record<string, string>
  areas: { key: string; label: string }[]
  onUse: () => void
  onDismiss: () => void
}) {
  const rows: [string, string][] = []
  if (result.bleeding) rows.push(['Bleeding', BLEED_LABEL[result.bleeding]])
  if (result.pain !== null) rows.push(['Pelvic pain', `${result.pain} out of 10`])
  if (result.symptomIds.length) rows.push(['Symptoms', result.symptomIds.map((id) => symptomLabel(id, customLabels)).join(', ')])
  if (result.impact !== null) {
    const level = IMPACT_CHOICES.find((c) => c.level === result.impact)?.label ?? ''
    const named = result.areas.map((k) => areas.find((a) => a.key === k)?.label ?? k).join(', ')
    rows.push(['Got in the way', named ? `${level}: ${named}` : level])
  }
  if (result.medications.length) rows.push(['Medication', result.medications.join(', ')])
  return (
    <div className="notice notice-info mt-3" role="status">
      <p className="font-semibold">I understood this:</p>
      <dl className="mt-1.5 space-y-0.5 text-[13.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="shrink-0" style={{ color: 'var(--ink-secondary)', minWidth: 110 }}>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {result.unmatched.length > 0 && (
        <p className="mt-1.5 text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
          Not on your list, so not added: {result.unmatched.join(', ')}. Add it with “+ Add another” if you want to track it.
        </p>
      )}
      <p className="mt-1.5 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
        Read by AI from your note. Words like “bad” become a rough pain score, so check it. Nothing is saved until you save.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary focus-ring" style={{ minHeight: 40 }} onClick={onUse}>
          Fill it in
        </button>
        <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 40 }} onClick={onDismiss}>
          No thanks
        </button>
      </div>
    </div>
  )
}

/** The patient decides: a suggestion is never saved without a tap. */
function SuggestionCard({
  label, result, customLabels, onAccept, onDecline,
}: {
  label: string
  result: Interpretation
  customLabels: Record<string, string>
  onAccept: () => void
  onDecline: () => void
}) {
  const existing = result.match === 'catalog'
  return (
    <div className="notice notice-info mt-3" role="status">
      {existing ? (
        <p>
          “{label}” sounds like <strong>{symptomLabel(result.catalogId, customLabels)}</strong>, which is already
          on your list{getSymptom(result.catalogId)?.clinicalTerm ? ` (your doctor sees “${clinicalLabel(result.catalogId)}”)` : ''}.
        </p>
      ) : (
        <p>
          Your doctor’s report will say <strong>{result.clinicalTerm}</strong>, with your words “{label}” beside it.
        </p>
      )}
      <p className="mt-1 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
        Suggested by AI from your words. Check it fits before you keep it.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary focus-ring" style={{ minHeight: 40 }} onClick={onAccept}>
          {existing ? 'Use that' : 'Keep this'}
        </button>
        <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 40 }} onClick={onDecline}>
          Just my own words
        </button>
      </div>
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
