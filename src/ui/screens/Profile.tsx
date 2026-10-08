import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { symptomDefinitions } from '../records'
import type { PatientProfile, PatientRecord, SymptomDomain } from '../../engine/types'
import { useApp } from '../store'

export default function Profile({ create = false }: { create?: boolean }) {
  const record = useApp(s => s.record)
  const busy = useApp(s => s.busy)
  const navigate = useNavigate()
  const [profile, setProfile] = useState<PatientProfile>(record ? record.profile : {
    id: crypto.randomUUID(), displayName: '', diagnosisStatus: 'undiagnosed',
    enabledDomains: ['pain', 'bowel', 'urinary', 'systemic'],
  })
  const [tracked, setTracked] = useState(record ? record.trackedSymptomIds : ['pelvic_pain', 'menstrual_pain', 'fatigue', 'bloating'])
  const [step, setStep] = useState(1)
  const [saved, setSaved] = useState(false)
  const [cycleMin, setCycleMin] = useState(profile.usualCycleLength?.[0]?.toString() ?? '')
  const [cycleMax, setCycleMax] = useState(profile.usualCycleLength?.[1]?.toString() ?? '')
  const update = (patch: Partial<PatientProfile>) => setProfile(p => ({ ...p, ...patch }))
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if(create && step<3){setStep(step+1);return}
    const next: PatientRecord = { ...(record ?? { days: [], treatments: [], clinicalEvents: [] }),
      profile: { ...profile, onboarded: true, displayName: profile.displayName.trim(),
        usualCycleLength: cycleMin && cycleMax ? [Number(cycleMin), Number(cycleMax)] : undefined },
      trackedSymptomIds: tracked }
    try {
      await useApp.getState().saveRecord(next)
      setSaved(true)
      if (create) navigate('/')
    } catch { /* Shared error banner displays database errors. */ }
  }
  return <form className="card mvp-form p-6 max-w-3xl" onSubmit={save}>
    <fieldset disabled={busy} className="mvp-lock">
    <h1>{create ? 'Let’s set up your health profile.' : 'Your health profile'}</h1>
    <p>A little context helps your record tell a fuller story. You can leave optional questions unanswered and change these details later.</p>
    {create && <div className="setup-progress" aria-label="Setup progress">{["Your context","What to track","Your preferences"].map((label,i)=><span key={label} className={step===i+1?"active":""}>{i+1} · {label}</span>)}</div>}
    {(!create || step===1) && <div className="space-y-5"><h2>Your health context</h2><div className="mvp-grid">
      <label>Display name<input required maxLength={80} value={profile.displayName} onChange={e => update({ displayName: e.target.value })} /></label>
      <label>Age range<input placeholder="e.g. 20–29" value={profile.ageRange ?? ''} onChange={e => update({ ageRange: e.target.value })} /></label>
      <label>Diagnosis status<select value={profile.diagnosisStatus} onChange={e => update({ diagnosisStatus: e.target.value as PatientProfile['diagnosisStatus'] })}>
        <option value="undiagnosed">Undiagnosed</option><option value="suspected">Suspected</option><option value="confirmed">Confirmed</option>
      </select></label>
      <label>Symptom onset year<input type="number" min="1900" max={new Date().getFullYear()} value={profile.symptomOnsetYear ?? ''} onChange={e => update({ symptomOnsetYear: e.target.value ? Number(e.target.value) : undefined })} /></label>
      <label>Cycle regularity<select value={profile.cycleRegularity ?? ''} onChange={e => update({ cycleRegularity: e.target.value as PatientProfile['cycleRegularity'] || undefined })}>
        <option value="">Unknown</option><option value="regular">Regular</option><option value="variable">Variable</option><option value="highly_irregular">Highly irregular</option>
      </select></label>
      <label>Age at first period<input type="number" min="5" max="30" value={profile.ageAtMenarche ?? ''} onChange={e => update({ ageAtMenarche: e.target.value ? Number(e.target.value) : undefined })} /></label>
      <label>Usual cycle length: shortest (days)<input type="number" min="10" max={cycleMax || 180} required={!!cycleMax} value={cycleMin} onChange={e => setCycleMin(e.target.value)} /></label>
      <label>Usual cycle length: longest (days)<input type="number" min={cycleMin || 10} max="180" required={!!cycleMin} value={cycleMax} onChange={e => setCycleMax(e.target.value)} /></label>
      <label>Family history<select value={profile.familyHistory === undefined ? '' : String(profile.familyHistory)} onChange={e => update({ familyHistory: e.target.value === '' ? undefined : e.target.value === 'true' })}><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select></label>
      <label>Previous pelvic surgery<select value={profile.previousPelvicSurgery === undefined ? '' : String(profile.previousPelvicSurgery)} onChange={e => update({ previousPelvicSurgery: e.target.value === '' ? undefined : e.target.value === 'true' })}><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select></label>
    </div>
    <label>Previous diagnoses or labels<textarea value={profile.priorLabels?.join('\n') ?? ''} placeholder="One per line" onChange={e => update({ priorLabels: e.target.value.split('\n').filter(Boolean) })} /></label>
    </div>}
    {(!create || step===2) && <div className="space-y-5"><h2>Choose what matters to you</h2><fieldset><legend>Symptom domains</legend><div className="flex flex-wrap gap-3">
      {(['pain', 'bowel', 'urinary', 'systemic', 'sexual', 'extrapelvic'] as SymptomDomain[]).map(domain => <label className="mvp-inline" key={domain}>
        <input type="checkbox" checked={profile.enabledDomains.includes(domain)} onChange={e => update({ enabledDomains: e.target.checked ? [...profile.enabledDomains, domain] : profile.enabledDomains.filter(d => d !== domain) })} />{domain}
      </label>)}
    </div><p>Sexual and other optional questions appear only when their domain is enabled.</p></fieldset>
    <fieldset><legend>Symptoms to track</legend><div className="mvp-grid">
      {symptomDefinitions(record!).filter(s => !s.archived && profile.enabledDomains.includes(s.domain)).map(s => <label className="mvp-inline" key={s.id}><input type="checkbox" checked={tracked.includes(s.id)} onChange={e => setTracked(t => e.target.checked ? [...t, s.id] : t.filter(id => id !== s.id))} />{s.label}</label>)}
    </div></fieldset>
    </div>}
    {(!create || step===3) && <div className="space-y-5"><h2>Make this work for your day</h2><label>Daily reminder time (optional)<input type="time" value={profile.reminderTime ?? ""} onChange={e => update({reminderTime:e.target.value})}/></label><p>Medication shortcuts and your own symptom wording can be added in Settings after setup.</p>
    </div>}
    <div className="flex flex-wrap gap-3">{create && step>1 && <button type="button" className="secondary-button" onClick={()=>setStep(step-1)}>← Back</button>}<button className="mvp-primary" disabled={busy}>{busy ? 'Saving…' : create ? (step<3 ? 'Continue →' : 'Finish setup →') : 'Save profile'}</button></div>
    {saved && <p role="status">Profile saved to the database.</p>}
    </fieldset>
  </form>
}
