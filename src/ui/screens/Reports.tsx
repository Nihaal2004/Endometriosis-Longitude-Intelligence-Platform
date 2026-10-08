import { useEffect,useState } from 'react'
import { Link } from 'react-router-dom'
import { api,download,useApp } from '../store'
import type { SavedReport,ReportListItem } from '../report'
import ReportView from '../ReportView'

export default function Reports(){
  const [list,setList]=useState<ReportListItem[]>([])
  const [report,setReport]=useState<SavedReport|null>(null)
  const [id,setId]=useState('')
  const [error,setError]=useState('')
  const [pending,setPending]=useState(false)
  const [share,setShare]=useState('')
  const [hours,setHours]=useState(24)
  const [grants,setGrants]=useState<{token_hash:string;report_id:string;expires_at:number;revoked:number}[]>([])
  const consent=useApp(s=>s.consents.report_export)
  useEffect(()=>{let active=true;void api<ReportListItem[]>('/reports').then(v=>{if(active)setList(v)}).catch(e=>{if(active)setError(e.message)});void api<typeof grants>('/shares').then(v=>{if(active)setGrants(v)}).catch(()=>{});return()=>{active=false}},[])
  async function open(id:string){setPending(true);setError('');setReport(null);setShare('');try{setReport(await api(`/reports/${id}`));setId(id)}catch(e){setError(e instanceof Error?e.message:'Unable to open report')}finally{setPending(false)}}
  async function createShare(){try{const result=await api<{url:string}>('/shares','POST',{reportId:id,hours});setShare(window.location.origin+result.url);setGrants(await api('/shares'))}catch(e){setError(e instanceof Error?e.message:'Unable to create visit link')}}
  return <div className="space-y-6"><div className="page-heading no-print"><span className="eyebrow">YOUR CONSULTATION HISTORY</span><h1>Clinical reports</h1><p>Reviewed snapshots keep their original evidence when your day-to-day record changes.</p><Link className="secondary-button" to="/brief">Prepare a new visit report →</Link></div>
    {error&&<p className="form-error no-print" role="alert">{error}</p>}
    <section className="card p-6 no-print">{list.length===0&&<div className="empty-state"><span>▤</span><h2>Your first report starts with a visit.</h2><p>Choose a scope, review a preview, and save it in the clinical visit workspace.</p></div>}{list.map(r=><div className="history-row" key={r.id}><div><b>Clinical visit report</b><small>{new Date(r.recorded_at).toLocaleString()}</small></div><button disabled={pending} className="text-button" onClick={()=>{void open(r.id)}}>Open report →</button></div>)}</section>
    {report&&<><div className="report-actions no-print"><button className="primary-button" disabled={!consent} onClick={()=>{void download(`/reports/${id}/pdf`,'medtrace-visit-report.pdf').catch(e=>setError(e.message))}}>Download PDF</button><button className="secondary-button" disabled={!consent} onClick={()=>window.print()}>Print</button><label>Visit link expiry <select value={hours} onChange={e=>setHours(Number(e.target.value))}><option value={1}>1 hour</option><option value={24}>24 hours</option><option value={168}>7 days</option></select></label><button className="text-button" disabled={!consent} onClick={()=>{void createShare()}}>Create local visit link</button></div>{share&&<div className="notice no-print"><p>This link works on this computer only. For a clinician elsewhere, download the PDF.</p><input aria-label="Local visit link" readOnly value={share}/><button onClick={()=>{void navigator.clipboard.writeText(share).catch(()=>setError('Copy the link manually from the field.'))}}>Copy link</button></div>}<ReportView report={report}/></>}
    {grants.length>0&&<section className="card p-6 no-print"><h2>Visit links</h2>{grants.map(g=><div className="history-row" key={g.token_hash}><span>{g.revoked?'Revoked':g.expires_at*1000<Date.now()?'Expired':`Expires ${new Date(g.expires_at*1000).toLocaleString()}`}</span>{!g.revoked&&<button onClick={()=>{void api('/shares/revoke','POST',{id:g.token_hash}).then(()=>setGrants(v=>v.map(x=>x.token_hash===g.token_hash?{...x,revoked:1}:x))).catch(e=>setError(e.message))}}>Revoke link</button>}</div>)}</section>}
  </div>
}
