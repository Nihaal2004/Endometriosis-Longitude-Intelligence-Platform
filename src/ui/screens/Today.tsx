/**
 * Today — the daily check-in.
 *
 * The whole product argument lives on this screen: a data model of 100+ fields, and
 * the patient sees four or five. Two things are shown here that a consumer tracker
 * does not show, both deliberate:
 *
 *   - Which questions were *skipped* and why. Question reduction that happens
 *     invisibly reads as the app forgetting; shown, it reads as the app learning.
 *   - That a skipped question is recorded as unknown, not as "no". This is the single
 *     most consequential difference between this record and a calendar-cell tracker,
 *     so it is stated on the screen where it happens.
 */

import { useEffect, useMemo, useState } from 'react'
import { CycleRing, type RingDay } from '../charts'
import { MY_RECORD_ID, useAnalysis, useApp, useCustomLabels, useRecord } from '../store'
import type { MyProfileInput } from '../../data/myRecord'
import { planDailyQuestions, explainDormancy } from '../../engine/adaptive'
import { symptomLabel, getSymptom, SYMPTOMS } from '../../engine/symptoms'
import { BLEEDING_LEVELS, ImpactLevel, IMPACT_LABELS, type BleedingLevel, type DayRecord, type SymptomObservation } from '../../engine/types'
import { addDays } from '../../engine/cycles'
import { extractFromNarrative, type NarrativeExtraction } from '../../engine/nlp'

const IMPACT_DOMAINS = ['Work', 'Education', 'Exercise', 'Sleep', 'Household', 'Social', 'Concentration', 'Mood']

const BLEED_LABEL: Record<BleedingLevel, string> = {
  none: 'None',
  spotting: 'Spotting',
  light: 'Light',
  moderate: 'Moderate',
  heavy: 'Heavy',
  very_heavy: 'Very heavy',
}

export default function Today() {
  const record = useRecord()
  const { ctx } = useAnalysis()
  const upsertDay = useApp((s) => s.upsertDay)
  const customLabels = useCustomLabels()
  const personaId = useApp((s) => s.personaId)
  const onboarded = useApp((s) => s.onboarded)
  const myProfile = useApp((s) => s.myProfile)
  const setMyProfile = useApp((s) => s.setMyProfile)
  const completeOnboarding = useApp((s) => s.completeOnboarding)

  const today = ctx.orderedDates[ctx.orderedDates.length - 1] ?? record.days[record.days.length - 1]?.date
  const existing = ctx.daysByDate.get(today)

  const plan = useMemo(() => planDailyQuestions(ctx, today), [ctx, today])

  const [bleeding, setBleeding] = useState<BleedingLevel>(existing?.bleeding ?? 'none')
  const [pain, setPain] = useState<number>(existing?.symptoms['pelvic_pain']?.severity ?? 0)
  const [impact, setImpact] = useState<ImpactLevel | null>(existing?.impact ?? null)
  const [domains, setDomains] = useState<string[]>(existing?.impactDomains ?? [])
  const [extra, setExtra] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const q of plan.surfaced) {
      init[q.symptomId] = existing?.symptoms[q.symptomId]?.state === 'present'
    }
    return init
  })
  const [meds, setMeds] = useState<string[]>(existing?.medications?.map((m) => m.label) ?? [])
  const [showMore, setShowMore] = useState(false)
  const [saved, setSaved] = useState(false)

  // ---------------- Free-text narrative -> structured extraction ----------------
  const [narrative, setNarrative] = useState<string>(existing?.note ?? '')
  const extraction: NarrativeExtraction | null = useMemo(
    () => (narrative.trim() ? extractFromNarrative(narrative) : null),
    [narrative],
  )
  // Per-match review state, keyed by symptomId: whether the patient keeps this
  // extracted entry, and the severity to actually save (editable — the extractor's
  // guess is a proposal, never applied silently).
  const [narrativeIncluded, setNarrativeIncluded] = useState<Record<string, boolean>>({})
  const [narrativeSeverity, setNarrativeSeverity] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!extraction) return
    setNarrativeIncluded((prev) => {
      const next = { ...prev }
      for (const m of extraction.matches) if (!(m.symptomId in next)) next[m.symptomId] = true
      return next
    })
    setNarrativeSeverity((prev) => {
      const next = { ...prev }
      for (const m of extraction.matches) {
        if (!(m.symptomId in next) && m.severity !== undefined) next[m.symptomId] = m.severity
      }
      return next
    })
  }, [extraction])

  const ringDays: RingDay[] = useMemo(() => {
    const currentCycle = ctx.cycles[ctx.cycles.length - 1]
    if (!currentCycle) return []

    // The current cycle is still running, so its recorded "length" is only the days
    // elapsed so far. Drawing the ring at that length would make five days into a
    // cycle look like a completed one. Size the ring to this patient's typical cycle
    // instead, and draw the not-yet-lived remainder as empty track.
    const complete = ctx.cycles.filter((c) => c.complete).map((c) => c.lengthDays)
    const typical = complete.length
      ? Math.round(complete.reduce((s, v) => s + v, 0) / complete.length)
      : 28
    const elapsed = currentCycle.lengthDays
    const ringLength = Math.max(elapsed, typical)

    const out: RingDay[] = []
    for (let i = 0; i < ringLength; i++) {
      const date = addDays(currentCycle.startDate, i)
      const day = ctx.daysByDate.get(date)
      const aligned = ctx.aligned.get(date)
      out.push({
        date,
        bleedLevel: day?.bleeding ? BLEEDING_LEVELS.indexOf(day.bleeding) : 0,
        logged: Boolean(day?.logged),
        isToday: date === today,
        signedCycleDay: aligned?.signedCycleDay ?? i,
        future: i >= elapsed,
      })
    }
    return out
  }, [ctx, today])

  const cycleDay = plan.cycleDay

  function save() {
    const symptoms: Record<string, SymptomObservation> = {}
    // Only questions that were actually asked get a state. Everything else stays
    // absent from the record and is therefore `unknown` — never a manufactured "no".
    symptoms['pelvic_pain'] = pain > 0 ? { state: 'present', severity: pain } : { state: 'absent' }
    for (const q of plan.surfaced) {
      if (q.symptomId === 'pelvic_pain') continue
      const on = extra[q.symptomId]
      const graded = getSymptom(q.symptomId)?.graded !== false
      symptoms[q.symptomId] = on
        ? graded
          ? { state: 'present', severity: Math.max(3, pain || 5) }
          : { state: 'present' }
        : { state: 'absent' }
    }

    // Narrative-derived entries are a separate, explicitly patient-reviewed source —
    // applied after the chip-based ones so a confirmed edit from the review list wins.
    // An explicit denial ("no nausea today") is recorded as `absent`, not left
    // `unknown`: the patient answered the question, just via text instead of a chip.
    if (extraction) {
      for (const m of extraction.matches) {
        if (!narrativeIncluded[m.symptomId]) continue
        const graded = getSymptom(m.symptomId)?.graded !== false
        symptoms[m.symptomId] = m.present
          ? graded
            ? { state: 'present', severity: narrativeSeverity[m.symptomId] ?? m.severity ?? 5 }
            : { state: 'present' }
          : { state: 'absent' }
      }
    }

    const day: DayRecord = {
      date: today,
      logged: true,
      bleeding,
      impact: impact ?? ImpactLevel.None,
      impactDomains: domains.length > 0 ? domains : undefined,
      symptoms,
      medications: meds.map((label) => ({ medicationId: label.toLowerCase(), label })),
      note: narrative.trim() || undefined,
      depth: 'standard',
    }
    upsertDay(day)
    setSaved(true)
    setTimeout(() => setSaved(false), 2600)
  }

  const moreSymptoms = SYMPTOMS.filter(
    (s) => !plan.surfaced.some((q) => q.symptomId === s.id) && s.id !== 'pelvic_pain',
  )

  return (
    <div className="flex flex-col gap-5">
      {personaId === MY_RECORD_ID && !onboarded && (
        <OnboardingCard profile={myProfile} onSave={setMyProfile} onDone={completeOnboarding} />
      )}
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      {/* ---------------- Cycle ring ---------------- */}
      <section className="card flex flex-col items-center p-5">
        <CycleRing
          days={ringDays}
          size={240}
          centre={
            <>
              <div className="text-[11px] font-medium uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>
                {cycleDay ? 'Cycle day' : 'Tracking'}
              </div>
              <div className="display" style={{ fontSize: 44, lineHeight: 1.05, marginTop: 2 }}>
                {cycleDay
                  ? cycleDay.signedCycleDay >= 0
                    ? `D${cycleDay.signedCycleDay}`
                    : `D${cycleDay.signedCycleDay}`
                  : '—'}
              </div>
              <div className="mt-1 text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
                {cycleDay?.inMenstrualWindow ? 'Perimenstrual window' : 'Outside period window'}
              </div>
            </>
          }
        />
        <div className="mt-3 text-center text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          {today}
        </div>
        <div className="mt-4 w-full rounded-xl p-3 text-[12px] leading-relaxed"
          style={{ background: 'var(--surface-sunken)', color: 'var(--ink-secondary)' }}>
          Dashes on the ring are days with no entry. They stay unknown — the analysis never
          reads them as symptom-free. The pale outer track is the rest of a typical cycle,
          not a prediction of when the next period will start.
        </div>

        <dl className="mt-4 w-full space-y-2">
          {[
            ['Days logged', `${ctx.loggedDays} of ${ctx.calendarDays}`],
            ['Coverage', `${Math.round(ctx.coverage * 100)}%`],
            ['Cycles in window', String(ctx.windowCycles.filter((c) => c.complete).length)],
          ].map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between text-[12.5px]">
              <dt style={{ color: 'var(--ink-muted)' }}>{k}</dt>
              <dd className="tnum" style={{ color: 'var(--ink)' }}>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---------------- Check-in ---------------- */}
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 style={{ fontSize: 26 }}>Today</h1>
          <span className="text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
            {plan.fieldCount} questions · about {Math.round(plan.fieldCount * 3.5)} seconds
          </span>
        </div>

        {/* Bleeding */}
        <Field label="Bleeding">
          <div className="flex flex-wrap gap-2">
            {BLEEDING_LEVELS.map((lvl) => (
              <button
                key={lvl}
                className="chip focus-ring"
                data-selected={bleeding === lvl}
                onClick={() => setBleeding(lvl)}
              >
                {lvl !== 'none' && (
                  <span
                    aria-hidden
                    style={{
                      width: 9, height: 9, borderRadius: 999, flexShrink: 0,
                      background: `color-mix(in srgb, var(--bleed) ${20 + BLEEDING_LEVELS.indexOf(lvl) * 18}%, transparent)`,
                      border: '1px solid var(--bleed)',
                    }}
                  />
                )}
                {BLEED_LABEL[lvl]}
              </button>
            ))}
          </div>
        </Field>

        {/* Pain */}
        <Field label="Pelvic pain">
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={0}
              max={10}
              value={pain}
              onChange={(e) => setPain(Number(e.target.value))}
              className="focus-ring h-2 flex-1"
              style={{ accentColor: 'var(--ink)' }}
              aria-label="Pelvic pain severity, 0 to 10"
            />
            <span className="display tnum" style={{ fontSize: 30, minWidth: 42, textAlign: 'right' }}>
              {pain}
            </span>
          </div>
        </Field>

        {/* Adaptive chips */}
        <Field
          label="Anything else today?"
          hint={
            plan.surfaced.some((q) => q.reason === 'cycle_phase')
              ? 'Some of these are surfaced because your period window is a time they usually appear.'
              : undefined
          }
        >
          <div className="flex flex-wrap gap-2">
            {plan.surfaced
              .filter((q) => q.symptomId !== 'pelvic_pain')
              .map((q) => (
                <button
                  key={q.symptomId}
                  className="chip focus-ring"
                  data-selected={Boolean(extra[q.symptomId])}
                  onClick={() => setExtra((s) => ({ ...s, [q.symptomId]: !s[q.symptomId] }))}
                >
                  {symptomLabel(q.symptomId, customLabels)}
                  {q.reason === 'cycle_phase' && (
                    <span aria-hidden style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--bleed)' }} />
                  )}
                </button>
              ))}
            <button
              className="chip focus-ring"
              onClick={() => setShowMore((v) => !v)}
              style={{ borderStyle: 'dashed' }}
            >
              {showMore ? 'Close' : '+ Add another'}
            </button>
          </div>

          {showMore && (
            <div className="mt-3 max-h-56 overflow-y-auto rounded-xl p-3"
              style={{ background: 'var(--surface-sunken)' }}>
              <p className="mb-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                The full vocabulary stays available at all times — nothing is ever removed, only
                de-prioritised.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {moreSymptoms.map((s) => (
                  <button
                    key={s.id}
                    className="chip focus-ring"
                    style={{ minHeight: 34, fontSize: 13 }}
                    data-selected={Boolean(extra[s.id])}
                    onClick={() => setExtra((v) => ({ ...v, [s.id]: !v[s.id] }))}
                  >
                    {symptomLabel(s.id, customLabels)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Field>

        {/* Free-text narrative */}
        <Field
          label="Or describe today in your own words"
          hint="Optional. Write however you'd naturally describe it — the app looks for symptom mentions and lets you confirm what it found before anything is saved."
        >
          <textarea
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            placeholder="e.g. My periods have been extremely painful lately. I also feel exhausted and sometimes get stomach pain when I use the bathroom."
            rows={3}
            className="focus-ring w-full rounded-xl px-3.5 py-3 text-[14px] leading-relaxed"
            style={{ border: '1px solid var(--hairline-strong)', background: 'var(--surface)', color: 'var(--ink)', resize: 'vertical' }}
          />

          {extraction && (
            <div className="mt-3 rounded-xl p-3.5" style={{ background: 'var(--surface-sunken)' }}>
              {extraction.matches.length === 0 ? (
                <p className="text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
                  No symptom mentions recognised yet — nothing will be added from this text.
                </p>
              ) : (
                <>
                  <p className="mb-2.5 text-[12px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>
                    Detected — review before saving
                  </p>
                  <div className="flex flex-col gap-2">
                    {extraction.matches.map((m) => {
                      const def = getSymptom(m.symptomId)
                      const included = narrativeIncluded[m.symptomId] ?? true
                      const graded = def?.graded !== false
                      const severity = narrativeSeverity[m.symptomId] ?? m.severity ?? 5
                      return (
                        <div
                          key={m.symptomId}
                          className="flex flex-wrap items-center gap-2.5 rounded-lg px-3 py-2"
                          style={{ background: 'var(--surface)', opacity: included ? 1 : 0.5 }}
                        >
                          <button
                            className="chip focus-ring"
                            data-selected={included}
                            onClick={() => setNarrativeIncluded((s) => ({ ...s, [m.symptomId]: !included }))}
                          >
                            {included ? '✓' : '+'} {symptomLabel(m.symptomId, customLabels)}
                            {!m.present && ' — denied'}
                          </button>
                          {m.present && graded && (
                            <>
                              <input
                                type="range"
                                min={0}
                                max={10}
                                value={severity}
                                disabled={!included}
                                onChange={(e) =>
                                  setNarrativeSeverity((s) => ({ ...s, [m.symptomId]: Number(e.target.value) }))
                                }
                                className="focus-ring h-1.5 w-24"
                                style={{ accentColor: 'var(--ink)' }}
                                aria-label={`Severity for ${symptomLabel(m.symptomId, customLabels)}`}
                              />
                              <span className="tnum text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
                                {severity}
                                {m.severityInferred && '*'}
                              </span>
                            </>
                          )}
                          <span className="text-[11.5px] italic" style={{ color: 'var(--ink-muted)' }}>
                            "{m.sourceText}"
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <p className="mt-2.5 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                    * severity not stated in the text — estimated at a neutral default, edit the slider if it's wrong.
                    {extraction.menstrualContext && ' Menstrual context detected.'}
                    {extraction.recentOnset && ' Reads as a recent change.'}
                    {extraction.durationText && ` Duration mentioned: "${extraction.durationText}".`}
                  </p>
                </>
              )}
            </div>
          )}
        </Field>

        {/* Impact */}
        <Field label="Did symptoms interfere with your day?">
          <div className="flex flex-col gap-2">
            {([0, 1, 2, 3] as ImpactLevel[]).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setImpact(lvl)}
                className="focus-ring flex items-center gap-3 rounded-xl px-4 py-3 text-left text-[14px] transition-colors"
                style={{
                  border: `1px solid ${impact === lvl ? 'var(--ink)' : 'var(--hairline-strong)'}`,
                  background: impact === lvl ? 'var(--surface-sunken)' : 'transparent',
                  color: 'var(--ink)',
                }}
                aria-pressed={impact === lvl}
              >
                <span
                  aria-hidden
                  style={{
                    width: 16, height: 16, borderRadius: 999, flexShrink: 0,
                    border: `2px solid ${impact === lvl ? 'var(--ink)' : 'var(--hairline-strong)'}`,
                    background: impact === lvl ? 'var(--ink)' : 'transparent',
                  }}
                />
                {IMPACT_LABELS[lvl]}
              </button>
            ))}
          </div>

          {/* Conditional follow-up: only when something was actually affected */}
          {impact !== null && impact >= ImpactLevel.ModifiedActivities && (
            <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--amber-soft)' }}>
              <p className="mb-2 text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
                What was affected?
              </p>
              <div className="flex flex-wrap gap-1.5">
                {IMPACT_DOMAINS.map((d) => (
                  <button
                    key={d}
                    className="chip focus-ring"
                    style={{ minHeight: 34, fontSize: 13 }}
                    data-selected={domains.includes(d.toLowerCase())}
                    onClick={() =>
                      setDomains((s) =>
                        s.includes(d.toLowerCase())
                          ? s.filter((x) => x !== d.toLowerCase())
                          : [...s, d.toLowerCase()],
                      )
                    }
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Field>

        {/* Medication */}
        <Field label="Medication">
          <div className="flex flex-wrap gap-2">
            {['Ibuprofen', 'Paracetamol', 'Mefenamic acid', 'Codeine'].map((m) => (
              <button
                key={m}
                className="chip focus-ring"
                data-selected={meds.includes(m)}
                onClick={() => setMeds((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]))}
              >
                {m}
              </button>
            ))}
            <button className="chip focus-ring" data-selected={meds.length === 0} onClick={() => setMeds([])}>
              None
            </button>
          </div>
        </Field>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            onClick={save}
            className="focus-ring rounded-full px-6 py-3 text-[15px] font-semibold"
            style={{ background: 'var(--ink)', color: 'var(--ground)', border: 'none' }}
          >
            Save today
          </button>
          {saved && (
            <span className="text-[13px]" style={{ color: 'var(--sage)' }}>
              Saved — the Patterns and Brief screens have recalculated.
            </span>
          )}
        </div>

        {/* Dormancy explanation */}
        {plan.dormant.length > 0 && (
          <div className="mt-6 rounded-xl p-4" style={{ background: 'var(--surface-sunken)' }}>
            <p className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
              Not asked today ({plan.dormant.length})
            </p>
            <ul className="mt-1.5 space-y-1">
              {plan.dormant.slice(0, 4).map((d) => (
                <li key={d.symptomId} className="text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
                  {explainDormancy(d)}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              These days are stored as <em>unknown</em> for those symptoms — not as “no”.
            </p>
          </div>
        )}
      </section>
      </div>
    </div>
  )
}

function OnboardingCard({
  profile,
  onSave,
  onDone,
}: {
  profile: MyProfileInput
  onSave: (p: MyProfileInput) => void
  onDone: () => void
}) {
  const [ageRange, setAgeRange] = useState(profile.ageRange ?? '')
  const [diagnosisStatus, setDiagnosisStatus] = useState(profile.diagnosisStatus ?? '')
  const [cycleRegularity, setCycleRegularity] = useState(profile.cycleRegularity ?? '')

  function start() {
    onSave({
      ageRange: ageRange || undefined,
      diagnosisStatus: (diagnosisStatus || undefined) as MyProfileInput['diagnosisStatus'],
      cycleRegularity: (cycleRegularity || undefined) as MyProfileInput['cycleRegularity'],
    })
    onDone()
  }

  return (
    <section className="card p-5 sm:p-6">
      <h2 style={{ fontSize: 18 }}>Before you start</h2>
      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        Everything below is optional and can be skipped entirely — the engine needs none of it to
        work, and nothing here is shared with anyone. It only helps the brief address you
        correctly.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-[13px]">
          <span className="mb-1 block font-medium" style={{ color: 'var(--ink)' }}>Age range</span>
          <input
            value={ageRange}
            onChange={(e) => setAgeRange(e.target.value)}
            placeholder="e.g. 24"
            className="focus-ring w-full rounded-lg px-3 py-2 text-[13.5px]"
            style={{ border: '1px solid var(--hairline-strong)', background: 'var(--surface)', color: 'var(--ink)' }}
          />
        </label>

        <label className="text-[13px]">
          <span className="mb-1 block font-medium" style={{ color: 'var(--ink)' }}>Diagnosis status</span>
          <select
            value={diagnosisStatus}
            onChange={(e) => setDiagnosisStatus(e.target.value)}
            className="focus-ring w-full rounded-lg px-3 py-2 text-[13.5px]"
            style={{ border: '1px solid var(--hairline-strong)', background: 'var(--surface)', color: 'var(--ink)' }}
          >
            <option value="">Prefer not to say</option>
            <option value="undiagnosed">Undiagnosed</option>
            <option value="suspected">Suspected</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </label>

        <label className="text-[13px]">
          <span className="mb-1 block font-medium" style={{ color: 'var(--ink)' }}>Cycle regularity</span>
          <select
            value={cycleRegularity}
            onChange={(e) => setCycleRegularity(e.target.value)}
            className="focus-ring w-full rounded-lg px-3 py-2 text-[13.5px]"
            style={{ border: '1px solid var(--hairline-strong)', background: 'var(--surface)', color: 'var(--ink)' }}
          >
            <option value="">Not sure</option>
            <option value="regular">Regular</option>
            <option value="variable">Variable</option>
            <option value="highly_irregular">Highly irregular</option>
          </select>
        </label>
      </div>

      <div className="mt-4 flex gap-3">
        <button
          onClick={start}
          className="focus-ring rounded-full px-5 py-2.5 text-[14px] font-semibold"
          style={{ background: 'var(--ink)', color: 'var(--ground)', border: 'none' }}
        >
          Start tracking
        </button>
        <button
          onClick={onDone}
          className="focus-ring rounded-full px-5 py-2.5 text-[14px]"
          style={{ border: '1px solid var(--hairline-strong)', background: 'transparent', color: 'var(--ink-secondary)' }}
        >
          Skip for now
        </button>
      </div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <label className="mb-2.5 block text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
        {label}
      </label>
      {hint && (
        <p className="mb-2 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </p>
      )}
      {children}
    </div>
  )
}
