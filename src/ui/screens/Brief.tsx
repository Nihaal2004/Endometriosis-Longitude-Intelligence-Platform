import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { SymptomDomain } from '../../engine/types'
import { useApp, useRecord, localDate, api, download } from '../store'
import { defaultWindow } from '../../engine/features'
import type { SavedReport } from '../report'
import ReportView from '../ReportView'

export default function Brief() {
  const record=useRecord()
  const revision=useApp(s=>s.revision)
  const consent=useApp(s=>s.consents.report_export)
  const windowDays=useApp(s=>s.windowDays)
  const initial=defaultWindow(record,windowDays)
  const [start,setStart]=useState(initial.start)
  const [end,setEnd]=useState(initial.end)
  const [visit,setVisit]=useState('')
  const [note,setNote]=useState('')
  const [domains,setDomains]=useState<SymptomDomain[]>(record.profile.enabledDomains.filter(d=>d!=='sexual'))
  const [sections,setSections]=useState(['findings','impact','change','medication'])
  const [treatments,setTreatments]=useState(true)
  const [events,setEvents]=useState(true)
  const [cycle,setCycle]=useState(true)
  const [fertility,setFertility]=useState(false)
  const [privateNotes,setPrivateNotes]=useState(false)
  const [report,setReport]=useState<SavedReport|null>(null)
  const [draft,setDraft]=useState('')
  const [saved,setSaved]=useState('')
  const [reviewed,setReviewed]=useState(false)
  const [pending,setPending]=useState(false)
  const [error,setError]=useState('')
  const invalidate=()=>{setReport(null);setDraft('');setSaved('');setReviewed(false)}
  async function preview(e:React.FormEvent) {
    e.preventDefault();setPending(true);setError('')
    try {const value=await api<{draftId:string;report:SavedReport}>('/reports/preview','POST',{revision,patientNote:note,visitDate:visit,scope:{start,end,domains,sections,treatments,events,cycle,fertility,privateNotes}});setReport(value.report);setDraft(value.draftId);setReviewed(false);setSaved('')}
    catch(e){setError(e instanceof Error?e.message:'Unable to prepare report')}finally{setPending(false)}
  }
  async function approve(){setPending(true);setError('');try{const value=await api<{id:string;report:SavedReport}>('/reports','POST',{draftId:draft,reviewed:true,requestId:crypto.randomUUID()});setSaved(value.id);setReport(value.report)}catch(e){setError(e instanceof Error?e.message:'Unable to save report')}finally{setPending(false)}}
  return <div className="space-y-6"><div className="page-heading no-print"><span className="eyebrow">PREPARE WITH CONFIDENCE</span><h1>Your next clinical visit</h1><p>A concise report, with the information you choose and evidence behind each computed statement.</p></div>
    {!consent?<section className="card p-6"><h2>Choose whether to prepare reports</h2><p>Clinical reports are optional. Enable report permission in Settings to generate, save, and download them locally.</p><Link to="/settings">Manage report permission →</Link></section>:<>
    <div className="visit-layout"><form className="card p-6 app-form no-print" onSubmit={preview}><fieldset disabled={pending}>
      <span className="eyebrow">1 · CHOOSE YOUR SCOPE</span><h2>What would you like to include?</h2>
      <div className="mvp-grid"><label>From<input required type="date" max={end} value={start} onChange={e=>{setStart(e.target.value);invalidate()}}/></label><label>To<input required type="date" min={start} max={localDate()} value={end} onChange={e=>{setEnd(e.target.value);invalidate()}}/></label></div>
      <label>Visit date (optional)<input type="date" value={visit} onChange={e=>{setVisit(e.target.value);invalidate()}}/></label>
      <label>My questions for the clinician<textarea maxLength={3000} value={note} onChange={e=>{setNote(e.target.value);invalidate()}} placeholder="What would you most like to discuss?"/></label>
      <fieldset><legend>Symptom domains</legend>{(['pain','bowel','urinary','systemic','sexual','extrapelvic'] as SymptomDomain[]).map(d=><label className="inline-check" key={d}><input type="checkbox" checked={domains.includes(d)} onChange={e=>{setDomains(a=>e.target.checked?[...a,d]:a.filter(v=>v!==d));invalidate()}}/>{d}</label>)}</fieldset>
      <fieldset><legend>Summary sections</legend>{[['findings','Longitudinal findings'],['impact','Life impact'],['change','Changes over time'],['medication','Medication and treatment']].map(([id,label])=><label className="inline-check" key={id}><input type="checkbox" checked={sections.includes(id)} onChange={e=>{setSections(a=>e.target.checked?[...a,id]:a.filter(v=>v!==id));invalidate()}}/>{label}</label>)}</fieldset>
      <label className="inline-check"><input type="checkbox" checked={cycle} onChange={e=>{setCycle(e.target.checked);invalidate()}}/>Include bleeding and cycle context</label>
      <label className="inline-check"><input type="checkbox" checked={treatments} onChange={e=>{setTreatments(e.target.checked);invalidate()}}/>Include medication and treatment records</label>
      <label className="inline-check"><input type="checkbox" checked={events} onChange={e=>{setEvents(e.target.checked);invalidate()}}/>Include healthcare history and previous labels</label>
      <label className="inline-check"><input type="checkbox" checked={fertility} onChange={e=>{setFertility(e.target.checked);invalidate()}}/>Include fertility events</label>
      <label className="inline-check"><input type="checkbox" checked={privateNotes} onChange={e=>{setPrivateNotes(e.target.checked);invalidate()}}/>Include my private notes and episode details</label>
      <p className="muted">Sexual health, fertility, and private notes are excluded initially. Evidence is calculated from your selected scope.</p>
      <button className="primary-button" disabled={pending||domains.length===0}>{pending?'Preparing locally…':'Generate report preview →'}</button>
    </fieldset></form><div className="visit-preview">
      {!report?<section className="card report-placeholder"><span>▤</span><h2>Your report will appear here.</h2><p>Choose a date range and the sections you want to share. The local engine will compute and verify a fresh report.</p></section>:<><div className="report-actions no-print"><span className="eyebrow">2 · REVIEW YOUR REPORT</span>{saved?<><span className="saved-pill">Reviewed & saved</span><button className="primary-button" onClick={()=>{void download(`/reports/${saved}/pdf`,'medtrace-visit-report.pdf').catch(e=>setError(e.message))}}>Download PDF</button><Link to="/reports">Report history →</Link></>:<><label className="inline-check"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} disabled={pending}/>I have reviewed this report and its scope.</label><button className="primary-button" disabled={!reviewed||pending} onClick={()=>{void approve()}}>Save reviewed report</button></>}</div><ReportView report={report}/></>}
    </div></div>{error&&<p className="form-error no-print" role="alert">{error}</p>}
    </>}
  </div>
}
