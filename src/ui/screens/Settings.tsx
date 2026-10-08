import { useEffect, useState } from 'react'
import { api, download, useApp, useRecord, type SessionData } from '../store'
import { SYMPTOMS } from '../../engine/symptoms'
import type { MedicationEntry, SymptomDefinition, SymptomDomain } from '../../engine/types'

export default function Settings() {
  const record = useRecord()
  const busy = useApp(s => s.busy)
  const user = useApp(s => s.user)!
  const consents = useApp(s => s.consents)
  const [audit, setAudit] = useState<{ action:string; recorded_at:string }[]>([])
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState('')
  const [label, setLabel] = useState('')
  const [domain, setDomain] = useState<SymptomDomain>('pain')
  const [graded, setGraded] = useState(true)
  const [mapping, setMapping] = useState('')
  const [medName, setMedName] = useState('')
  const [medDose, setMedDose] = useState('')
  const [reminder, setReminder] = useState(record.profile.reminderTime ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [eraseDomain,setEraseDomain]=useState('sexual')
  const [eraseConfirmation,setEraseConfirmation]=useState('')
  const [erasePassword,setErasePassword]=useState('')
  const [confirmation, setConfirmation] = useState('')
  useEffect(() => { void api<typeof audit>('/audit').then(setAudit).catch(() => {}) }, [record])
  async function act(fn: () => Promise<unknown>, text: string) { setMessage(''); try { await fn(); setMessage(text); return true } catch(e) { setMessage(e instanceof Error ? e.message : 'Unable to complete request'); return false } }
  async function addSymptom(e: React.FormEvent) {
    e.preventDefault()
    const definition: SymptomDefinition & { mappedTo?: string } = { id: editing || `custom_${crypto.randomUUID()}`, label: label.trim(), domain, graded, sensitive: domain === 'sexual', mappedTo: mapping || undefined }
    const success=await act(() => useApp.getState().saveRecord({ ...record, customSymptoms: [...(record.customSymptoms ?? []).filter(s=>s.id!==definition.id), definition], trackedSymptomIds: [...new Set([...record.trackedSymptomIds, definition.id])] }), editing ? 'Custom symptom updated.' : 'Custom symptom added.')
    if(success){setLabel('');setEditing('')}
  }
  async function addMedication(e: React.FormEvent) {
    e.preventDefault()
    const medication: MedicationEntry = { medicationId: crypto.randomUUID(), label: medName.trim(), dose: medDose.trim() || undefined }
    if(await act(() => useApp.getState().saveRecord({ ...record, medicationList: [...(record.medicationList ?? []), medication] }), 'Medication added to your shortcuts.')) {setMedName(''); setMedDose('')}
  }
  return <div className="space-y-6"><div className="page-heading"><span className="eyebrow">YOUR PREFERENCES</span><h1>Settings & privacy</h1><p>You decide what is collected, analysed, and included in a report.</p></div>
    {message && <p role="status" className="notice">{message}</p>}
    <section className="card p-6"><h2>Privacy permissions</h2><p className="muted">Permissions are recorded locally. Withdrawing analysis stops insights and new reports; your existing observations remain accessible.</p>
      {([['health_storage','Store health observations','Required to save or edit your health record.'], ['health_analysis','Analyse my record','Show descriptive summaries, supported patterns, and report previews.'], ['report_export','Prepare and export clinical reports','Save reviewed reports, download PDFs, and create visit links on this computer.']] as const).map(([purpose,title,detail]) => <label className="preference-row" key={purpose}><span><b>{title}</b><small>{detail}</small></span><input type="checkbox" disabled={busy} checked={!!consents[purpose]} onChange={e => { void useApp.getState().setConsent(purpose,e.target.checked).catch(()=>{}) }} /></label>)}
      <p className="muted">Export permission withdrawal also blocks access through existing visit links. There is no external AI permission because no cloud AI is used.</p>
    </section>
    <div className="settings-grid"><section className="card p-6"><h2>Your own symptom wording</h2><p className="muted">Track something in your own words. Clinical mapping is optional and does not imply a diagnosis.</p><form className="app-form" onSubmit={addSymptom}><fieldset disabled={busy}>
      <label>Your symptom<input required maxLength={150} value={label} onChange={e=>setLabel(e.target.value)} placeholder="e.g. sharp pain down my left thigh" /></label>
      <label>Domain<select value={domain} onChange={e=>setDomain(e.target.value as SymptomDomain)}>{['pain','bowel','urinary','systemic','sexual','extrapelvic'].map(d=><option key={d}>{d}</option>)}</select></label>
      <label>Closest standard symptom (optional)<select value={mapping} onChange={e=>setMapping(e.target.value)}><option value="">Keep my wording only</option>{SYMPTOMS.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      <label className="inline-check"><input type="checkbox" checked={graded} onChange={e=>setGraded(e.target.checked)} />Allow a severity rating</label><button className="secondary-button">{editing?'Save symptom wording':'Add custom symptom'}</button>{editing&&<button type="button" onClick={()=>{setEditing('');setLabel('')}}>Cancel editing</button>}
    </fieldset></form>{record.customSymptoms?.map(s=><div className="history-row" key={s.id}><span>{s.label}<small>{s.domain}{s.archived?" · archived":""}</small></span><button onClick={()=>{setEditing(s.id);setLabel(s.label);setDomain(s.domain);setGraded(s.graded);setMapping(s.mappedTo??"")}}>Edit / restore</button><button disabled={busy} onClick={()=>{ void act(()=>useApp.getState().saveRecord({...record,trackedSymptomIds:record.trackedSymptomIds.filter(id=>id!==s.id), customSymptoms:record.customSymptoms!.map(v=>v.id===s.id?{...v,archived:true}:v)}),'Symptom archived; historical observations are preserved.') }}>Archive</button></div>)}</section>
      <section className="card p-6"><h2>Medication shortcuts</h2><p className="muted">Keep your usual medication names here to make logging faster. MedTrace does not recommend doses.</p><form className="app-form" onSubmit={addMedication}><fieldset disabled={busy}><label>Name<input required maxLength={200} value={medName} onChange={e=>setMedName(e.target.value)} /></label><label>Your recorded dose or schedule<input maxLength={200} value={medDose} onChange={e=>setMedDose(e.target.value)} /></label><button className="secondary-button">Add medication</button></fieldset></form>{record.medicationList?.map(m=><div className="history-row" key={m.medicationId}><span>{m.label}<small>{m.dose}</small></span><button disabled={busy} onClick={()=>{ void act(()=>useApp.getState().saveRecord({...record,medicationList:record.medicationList!.filter(v=>v.medicationId!==m.medicationId)}),'Shortcut removed. Daily medication records are unchanged.') }}>Remove</button></div>)}</section></div>
    <section className="card p-6"><h2>A gentle reminder</h2><p className="muted">A generic reminder can appear while MedTrace is open. No symptom details are shown in notifications.</p><div className="flex gap-3 flex-wrap app-form"><label>Reminder time<input type="time" value={reminder} onChange={e=>setReminder(e.target.value)} /></label><button className="secondary-button" disabled={busy} onClick={()=>{ void act(()=>useApp.getState().saveRecord({...record,profile:{...record.profile,reminderTime:reminder}}),'Reminder time saved.') }}>Save time</button><button className="text-button" onClick={()=>{ if ('Notification' in window) void Notification.requestPermission().then(permission=>setMessage(permission==='granted'?'Browser notifications enabled.':'Notifications were not enabled.')) }}>Enable browser notifications</button></div></section>
    <section className="card p-6"><h2>Your data</h2><p>Download your observations, retained revisions, documents, permissions, and activity history. Reviewed reports are included when export permission is enabled. Keep the exported file somewhere private.</p><button className="secondary-button" onClick={()=>{ void act(()=>download('/export','medtrace-data.json'),'Data export downloaded.') }}>Download my data</button></section>
    {user.kind==='local' && <section className="card p-6"><h2>Change password</h2><form className="app-form" onSubmit={e=>{e.preventDefault(); void act(async()=>{const session=await api<SessionData>('/account/password','POST',{currentPassword,password}); useApp.getState().acceptSession(session)},'Password changed. Other sessions were signed out.')}}><label>Current password<input required type="password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} /></label><label>New password<input required type="password" minLength={10} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} /></label><button className="secondary-button">Update password</button></form></section>}
    <section className="card p-6"><h2>Activity history</h2><p className="muted">Recent local account and report actions. Clinical contents are never written into this log.</p><details><summary>Show recent activity</summary>{audit.map((event,i)=><div className="history-row" key={i}><span>{event.action.replaceAll('_',' ')}</span><small>{new Date(event.recorded_at).toLocaleString()}</small></div>)}</details></section>
    <section className="card p-6"><h2>Erase a symptom domain</h2><p className="muted">Disabling a domain in your profile only stops new collection. This action permanently removes its structured symptom observations and custom definitions from retained revisions and deletes affected saved reports and links. Free-text notes, uploaded documents, and exported copies remain; delete the account to remove all local health data.</p><form className="app-form mt-5" onSubmit={e=>{e.preventDefault();void act(async()=>{const session=await api<SessionData>('/privacy/erase-domain','POST',{domain:eraseDomain,revision:useApp.getState().revision,confirmation:eraseConfirmation,password:erasePassword});useApp.getState().acceptSession(session)},'Domain observations erased.')}}><label>Domain to erase<select value={eraseDomain} onChange={e=>setEraseDomain(e.target.value)}>{['pain','bowel','urinary','systemic','sexual','extrapelvic'].map(d=><option key={d}>{d}</option>)}</select></label>{user.kind==='local'&&<label>Confirm your password<input required type="password" value={erasePassword} onChange={e=>setErasePassword(e.target.value)}/></label>}<label>Type ERASE<input required pattern="ERASE" value={eraseConfirmation} onChange={e=>setEraseConfirmation(e.target.value)}/></label><button className="danger-button">Erase domain observations</button></form></section>
    <section className="card danger-zone p-6"><h2>Delete this account and its records</h2><p>This removes the local account, observation revisions, reports, documents, sessions, and visit links. Files you have already exported are separate copies.</p><form className="app-form" onSubmit={e=>{e.preventDefault(); void act(async()=>{await api('/account','DELETE',{password:deletePassword,confirmation}); useApp.getState().acceptSession({user:null})},'Account deleted.')}}>{user.kind==='local'&&<label>Confirm your password<input required type="password" value={deletePassword} onChange={e=>setDeletePassword(e.target.value)} /></label>}<label>Type DELETE<input required pattern="DELETE" value={confirmation} onChange={e=>setConfirmation(e.target.value)} /></label><button className="danger-button">Permanently delete local account</button></form></section>
  </div>
}
