import { useEffect, useState } from 'react'
import type { SavedReport } from './report'
import type { Claim } from '../engine/types'
import { SAFETY_STATEMENT } from '../engine/brief'
import { symptomLabel } from '../engine/symptoms'

const TITLES: Record<string,string> = {period:'Record & coverage',findings:'Longitudinal findings',impact:'Functional impact',change:'Changes over time',medication:'Medication and treatment',quality:'Data quality'}
export default function ReportView({ report }: { report: SavedReport }) {
  const [claim,setClaim]=useState<Claim|null>(null)
  useEffect(()=>{if(!claim)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setClaim(null)};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[claim])
  const labels=Object.fromEntries((report.sourceRecord.customSymptoms??[]).map(s=>[s.id,s.label]))
  const medications=[...new Set(report.sourceRecord.days.filter(d=>d.date>=report.windowStart&&d.date<=report.windowEnd).flatMap(d=>(d.medications??[]).map(m=>`${m.label}${m.dose?` · ${m.dose}`:''}`)))]
  const method=claim?report.findings.find(f=>f.id===claim.findingId):undefined
  return <><article className="report-paper card p-6 sm:p-8">
    <header className="report-letterhead"><div><span className="eyebrow">MEDTRACE · CLINICAL VISIT REPORT</span><h1>My longitudinal health history</h1><p>Patient-reported observations, organized for a clinical conversation.</p></div><span className="report-seal">m</span></header>
    <div className="report-person"><strong>{report.profile.displayName}</strong><span>{report.profile.ageRange} · {report.profile.diagnosisStatus}</span><span>{report.windowStart} — {report.windowEnd}</span>{report.visitDate&&<span>Visit date: {report.visitDate}</span>}</div>
    {report.scope?.events&&<section><h2>Baseline history</h2><p>{report.profile.symptomOnsetYear?`Symptoms reported since ${report.profile.symptomOnsetYear}. `:''}{report.profile.familyHistory!==undefined?`Family history: ${report.profile.familyHistory?'reported':'not reported'}. `:''}{report.profile.previousPelvicSurgery!==undefined?`Previous pelvic surgery: ${report.profile.previousPelvicSurgery?'reported':'not reported'}.`:''}</p></section>}
    {report.patientNote&&<section><h2>Questions for my visit</h2><p style={{whiteSpace:'pre-wrap'}}>{report.patientNote}</p></section>}
    {report.concerns.length>0&&<section><h2>Main concerns</h2><ol>{report.concerns.map((c,i)=><li key={i}>{c}</li>)}</ol></section>}
    {!!report.profile.priorLabels?.length&&<section><h2>Previous patient-reported labels</h2><p>{report.profile.priorLabels?.join('; ')}</p></section>}
    {Object.entries(TITLES).map(([section,title])=>{const claims=report.claims.filter(c=>c.section===section);return claims.length>0&&<section key={section}><h2>{title}</h2>{claims.map(c=><p key={c.id}>{c.text}<button className="evidence-link no-print" onClick={()=>setClaim(c)}>View evidence ↗</button></p>)}</section>})}
    {report.treatments.length>0&&<section><h2>Patient-reported treatments</h2>{report.treatments.map(t=><p key={t.id}><b>{t.label}</b> · {t.startDate} — {t.endDate??'ongoing'}{t.dose&&<> · {t.dose}</>}{t.reason&&<><br/>Reason: {t.reason}</>}{!!t.sideEffects?.length&&<><br/>Reported side effects: {t.sideEffects?.join('; ')}</>}{t.patientPerceivedChange&&<><br/>Perceived change: {t.patientPerceivedChange}</>}</p>)}</section>}
    {medications.length>0&&<section><h2>Medication recorded during this period</h2>{medications.map(m=><p key={m}>{m}</p>)}</section>}
    {report.clinicalEvents.length>0&&<section><h2>Healthcare timeline</h2>{[...report.clinicalEvents].sort((a,b)=>a.date.localeCompare(b.date)).map(e=><p key={e.id}><b>{e.date} · {e.label}</b>{e.reason&&<> — {e.reason}</>}{e.outcome&&<><br/>{e.outcome}</>}</p>)}</section>}
    {report.scope?.privateNotes&&<section><h2>Patient-selected private notes</h2>{report.sourceRecord.days.filter(d=>(d.note||d.episode)&&d.date>=report.windowStart&&d.date<=report.windowEnd).map(d=><p key={d.date}><b>{d.date}</b><br/>{d.note}{d.episode&&<><br/>{Object.entries(d.episode).filter(([,value])=>value!==undefined&&value!=="").map(([key,value])=>`${key==="durationMinutes"?"Duration (minutes)":key}: ${value}`).join(" · ")}</>}</p>)}</section>}
    <footer><p>{report.safetyStatement??SAFETY_STATEMENT}</p>{report.savedAt&&<small>Reviewed {new Date(report.savedAt).toLocaleString()} · record version {report.recordRevision}</small>}</footer>
  </article>
  {claim&&<div className="evidence-modal no-print" role="dialog" aria-modal="true" aria-label="Evidence behind this statement"><div className="card p-6"><div className="section-heading"><h2>Behind this statement</h2><button aria-label="Close evidence" onClick={()=>setClaim(null)}>✕</button></div><p>{claim.text}</p>{method?.test&&<p className="muted">Method: {method.test.name}</p>}<p>{claim.evidenceDates.length} contributing dates. Unknown observations are excluded.</p><div className="evidence-scroll">{claim.evidenceDates.map(date=>{const d=report.sourceRecord.days.find(v=>v.date===date);return <div className="history-row" key={date}><b>{date}</b><span>{d?Object.entries(d.symptoms).map(([id,o])=>`${symptomLabel(id,labels)}: ${o.state}${o.severity?` (${o.severity}/10)`:''}`).join(' · '):'No symptom entry'}</span></div>})}{claim.evidenceDates.length===0&&<p>Record-level counts are computed from the saved report window.</p>}</div></div></div>}
  </>
}
