import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp, useCustomLabels, useRecord, localDate } from '../store'
import { planDailyQuestions, explainDormancy } from '../../engine/adaptive'
import { BLEEDING_LEVELS, IMPACT_LABELS, type BleedingLevel, type DayRecord, type ImpactLevel, type SymptomObservation } from '../../engine/types'
import { buildFeatureContext, defaultWindow } from '../../engine/features'
import { symptomDefinitions } from '../records'
import AssistedEntry from '../AssistedEntry'
import ConfirmRemove from '../ConfirmRemove'

export default function Today() {
  const record = useRecord()
  const date = useApp(s => s.selectedDate)
  const revision = useApp(s => s.revision)
  return <CheckIn key={`${record.profile.id}:${date}:${revision}`} />
}
function CheckIn() {
  const record = useRecord()
  const analysisAllowed = useApp(s => s.consents.health_analysis)
  const windowDays = useApp(s => s.windowDays)
  const ctx = useMemo(() => analysisAllowed ? buildFeatureContext(record, defaultWindow(record, windowDays)) : null, [record, windowDays, analysisAllowed])
  const date = useApp(s => s.selectedDate)
  const busy = useApp(s => s.busy)
  const labels = useCustomLabels()
  const existing = record.days.find(d => d.date === date)
  const plan = useMemo(() => ctx ? planDailyQuestions(ctx, date,
    record.trackedSymptomIds.filter(id => symptomDefinitions(record).some(s=>s.id===id && s.sensitive && record.profile.enabledDomains.includes(s.domain)))) : {cycleDay:null,dormant:[],surfaced:record.trackedSymptomIds.slice(0,4).map(symptomId=>({symptomId}))}, [ctx, date, record])
  const [depth, setDepth] = useState<NonNullable<DayRecord['depth']>>(existing?.depth ?? 'standard')
  const [bleeding, setBleeding] = useState<BleedingLevel | ''>(existing?.bleeding ?? '')
  const [impact, setImpact] = useState<ImpactLevel | ''>(existing?.impact ?? '')
  const [symptoms, setSymptoms] = useState<Record<string, SymptomObservation>>(existing?.symptoms ?? {})
  const [meds, setMeds] = useState(existing?.medications ?? [])
  const [medsKnown, setMedsKnown] = useState(existing?.medications !== undefined)
  const [medName, setMedName] = useState('')
  const [medDose, setMedDose] = useState('')
  const [note, setNote] = useState(existing?.note ?? '')
  const [domains, setDomains] = useState(existing?.impactDomains ?? [])
  const [showMore, setShowMore] = useState(false)
  const [location, setLocation] = useState(existing?.episode?.location ?? '')
  const [duration, setDuration] = useState(existing?.episode?.durationMinutes?.toString() ?? '')
  const [trigger, setTrigger] = useState(existing?.episode?.trigger ?? '')
  const [character, setCharacter] = useState(existing?.episode?.character ?? '')
  const [timing, setTiming] = useState(existing?.episode?.timing ?? '')
  const [response, setResponse] = useState(existing?.episode?.response ?? '')
  const surfaced = plan.surfaced.filter(q => record.trackedSymptomIds.includes(q.symptomId))
  const visibleIds = new Set(['pelvic_pain', ...(depth === 'quick' ? surfaced.slice(0, 1) : surfaced).map(q => q.symptomId), ...Object.keys(symptoms).filter(id => symptoms[id].state !== 'unknown')])
  const allowed = symptomDefinitions(record).filter(s => record.profile.enabledDomains.includes(s.domain) && (!s.archived || existing?.symptoms[s.id]))
  const visible = allowed.filter(s => showMore || visibleIds.has(s.id))
  const update = (id: string, observation: SymptomObservation) => setSymptoms(s => ({ ...s, [id]: observation }))
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const medications = [...meds, ...(medName.trim() ? [{ medicationId: crypto.randomUUID(), label: medName.trim(), dose: medDose || undefined }] : [])]
    const day: DayRecord = { date, logged: true, depth, symptoms,
      bleeding: bleeding || undefined, impact: impact === '' ? undefined : impact,
      impactDomains: impact !== '' && impact >= 2 ? domains : undefined,
      medications: medications.length > 0 || medsKnown ? medications : undefined, note: note || undefined,
      episode: depth === 'detailed' ? { location, character, timing, durationMinutes: duration ? Number(duration) : undefined, trigger, response } : existing?.episode }
    try { await useApp.getState().upsertDay(day) } catch { return }
  }
  return <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
    <aside className="card p-5 space-y-4"><h2>Your record</h2>
      <p>{plan.cycleDay ? `Cycle day ${plan.cycleDay.signedCycleDay} · ${plan.cycleDay.inMenstrualWindow ? 'Perimenstrual window' : 'Outside period window'}` : 'Cycle phase is not established for this date.'}</p>
      {ctx && <p>{ctx.loggedDays} logged days · {Math.round(ctx.coverage * 100)}% coverage</p>}
      {ctx && <p>{ctx.windowCycles.filter(c => c.complete).length} complete cycles in the analysis window</p>}
      <p>Unanswered questions remain unknown. Select “Absent” only when you actually observed no symptom.</p>
      {analysisAllowed && <><Link to="/patterns">View insights →</Link><br /><Link to="/brief">Prepare clinical visit →</Link></>}
      <h3>Recent entries</h3>
      {[...record.days].slice(-10).reverse().map(d => <button disabled={busy} className="mvp-row w-full" key={d.date} onClick={() => useApp.getState().setDate(d.date)}>{d.date} · {d.depth ?? 'standard'}</button>)}
      {record.days.length === 0 && <p>Your first entry starts the record. Patterns need more observations over time.</p>}
    </aside>
    <form className="card mvp-form p-6" onSubmit={save}><h1>Daily check-in</h1>
      <fieldset disabled={busy} className="mvp-lock">
      <div className="mvp-grid"><label>Entry date<input type="date" required max={localDate()} value={date} onChange={e => { if (e.target.value) useApp.getState().setDate(e.target.value) }} /></label>
        <label>Check-in depth<select value={depth} onChange={e => setDepth(e.target.value as typeof depth)}><option value="quick">Quick</option><option value="standard">Standard</option><option value="detailed">Detailed episode</option></select></label></div>
      <p>{existing ? 'Editing a saved entry. Existing answers are preserved until you change them.' : 'New entry. Leave questions unanswered if you do not know.'}</p>
      <label>Bleeding<select value={bleeding} onChange={e => setBleeding(e.target.value as BleedingLevel | '')}><option value="">Unknown / unanswered</option>{BLEEDING_LEVELS.map(v => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}</select></label>
      <AssistedEntry record={record} confirm={answers=>setSymptoms(s=>({...s,...answers}))}/>
      <fieldset><legend>Symptoms</legend>
        {visible.map(s => <div className="mvp-symptom" key={s.id}>
          <label>{labels[s.id] ?? s.label}<select aria-label={`${s.label} observation`} disabled={!!s.archived} value={symptoms[s.id]?.state ?? 'unknown'} onChange={e => update(s.id, { state: e.target.value as SymptomObservation['state'] })}>
            <option value="unknown">Unknown / unanswered</option><option value="absent">Absent</option><option value="present">Present</option>
          </select></label>
          {s.graded && symptoms[s.id]?.state === 'present' && <label>Severity (optional)<select aria-label={`${s.label} severity`} disabled={!!s.archived} value={symptoms[s.id]?.severity ?? ''} onChange={e => update(s.id, { state: 'present', severity: e.target.value ? Number(e.target.value) : undefined })}><option value="">Not rated</option>{Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}/10</option>)}</select></label>}
        </div>)}
        <button type="button" onClick={() => setShowMore(v => !v)}>{showMore ? 'Show adaptive questions' : '+ Add another symptom'}</button>
      </fieldset>
      <label>Did symptoms interfere with your day?<select value={impact} onChange={e => setImpact(e.target.value === '' ? '' : Number(e.target.value) as ImpactLevel)}><option value="">Unknown / unanswered</option>{([0, 1, 2, 3] as ImpactLevel[]).map(n => <option value={n} key={n}>{IMPACT_LABELS[n]}</option>)}</select></label>
      {impact !== '' && impact >= 2 && <fieldset><legend>Activities affected</legend><div className="flex flex-wrap gap-3">{['work', 'education', 'exercise', 'sleep', 'household', 'social', 'concentration', 'mood'].map(v => <label className="mvp-inline" key={v}><input type="checkbox" checked={domains.includes(v)} onChange={e => setDomains(s => e.target.checked ? [...s, v] : s.filter(d => d !== v))} />{v}</label>)}</div></fieldset>}
      {depth !== 'quick' && <fieldset><legend>Medication taken</legend>
        <label className="mvp-inline"><input type="checkbox" checked={medsKnown} onChange={e => setMedsKnown(e.target.checked)} />Medication answer confirmed (empty list means none taken)</label>
        {meds.map((m, i) => <div key={i} className="mvp-row"><span>{m.label} {m.dose}</span><button type="button" onClick={() => setMeds(s => s.filter((_, n) => n !== i))}>Remove</button></div>)}
        <div className="flex flex-wrap gap-2">{record.medicationList?.map(m => <button type="button" key={m.medicationId} onClick={() => { setMeds(items => [...items, {...m}]); setMedsKnown(true) }}>+ {m.label}</button>)}</div><div className="mvp-grid"><label>Medication name<input maxLength={200} value={medName} onChange={e => setMedName(e.target.value)} placeholder="e.g. Ibuprofen" /></label><label>Dose / schedule<input maxLength={200} value={medDose} onChange={e => setMedDose(e.target.value)} placeholder="Optional" /></label></div>
        <button type="button" disabled={!medName.trim()} onClick={() => { setMeds(s => [...s, { medicationId: crypto.randomUUID(), label: medName.trim(), dose: medDose || undefined }]); setMedName(''); setMedDose('') }}>Add medication</button>
        {depth === 'detailed' && meds.map((m, i) => <label key={m.medicationId}>Relief after {m.label} (optional)<select value={m.perceivedRelief ?? ''} onChange={e => setMeds(items => items.map((item, n) => n === i ? { ...item, perceivedRelief: e.target.value === '' ? undefined : Number(e.target.value) } : item))}><option value="">Not rated</option>{Array.from({ length: 11 }, (_, n) => <option value={n} key={n}>{n}/10</option>)}</select></label>)}
      </fieldset>}
      {depth === 'detailed' && <fieldset><legend>Episode detail</legend><div className="mvp-grid">
        <label>Pain location<input value={location} onChange={e => setLocation(e.target.value)} /></label><label>Duration in minutes<input type="number" min="1" max="1440" value={duration} onChange={e => setDuration(e.target.value)} /></label>
        <label>Pain character<input maxLength={500} value={character} onChange={e => setCharacter(e.target.value)} placeholder="e.g. aching, sharp, cramping" /></label><label>Timing<input maxLength={500} value={timing} onChange={e => setTiming(e.target.value)} placeholder="e.g. intermittent, morning" /></label><label>Trigger<input value={trigger} onChange={e => setTrigger(e.target.value)} /></label><label>What helped / response<input value={response} onChange={e => setResponse(e.target.value)} /></label>
      </div></fieldset>}
      {depth !== 'quick' && <label>Daily note<textarea maxLength={3000} value={note} onChange={e => setNote(e.target.value)} /></label>}
      <p className="muted">If you feel seriously unwell or believe your symptoms need urgent attention, seek clinical help. This check-in does not assess emergencies.</p>
      <button className="mvp-primary" disabled={busy}>{busy ? 'Saving to database…' : existing ? 'Save changes' : 'Save check-in'}</button>
      {existing && <p role="status">This date has a saved entry. Save changes to update your record.</p>}
      {existing && <ConfirmRemove label="entry" remove={() => useApp.getState().saveRecord({ ...record, days: record.days.filter(d => d.date !== date) })} />}
      {plan.dormant.length > 0 && <details><summary>Why some questions were skipped</summary>{plan.dormant.filter(d => allowed.some(s => s.id === d.symptomId)).map(d => <p key={d.symptomId}>{explainDormancy(d)}</p>)}</details>}
      </fieldset>
    </form>
  </div>
}
