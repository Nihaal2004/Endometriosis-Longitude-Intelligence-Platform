import { useEffect, useState } from 'react'
import { api, download, useApp, useRecord } from './store'
import ConfirmRemove from './ConfirmRemove'
type Document = {id:string;eventId:string;filename:string;mime:string}
export default function Attachments() {
  const record=useRecord()
  const storage=useApp(s=>s.consents.health_storage)
  const [documents,setDocuments]=useState<Document[]>([])
  const [eventId,setEventId]=useState('')
  const [file,setFile]=useState<File|null>(null)
  const [pending,setPending]=useState(false)
  const [message,setMessage]=useState('')
  const refresh=()=>api<Document[]>('/attachments').then(setDocuments)
  useEffect(()=>{void refresh().catch(e=>setMessage(e.message))},[record.clinicalEvents])
  async function upload(e:React.FormEvent) {
    e.preventDefault();if(!file)return
    setPending(true);setMessage('')
    try {
      if(file.size>5000000)throw new Error('Choose a PDF or image of at most 5 MB.')
      const content=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Unable to read document'));reader.readAsDataURL(file)})
      await api('/attachments','POST',{eventId,filename:file.name,mime:file.type,content});await refresh();setFile(null);setMessage('Document stored locally and encrypted.')
    }catch(e){setMessage(e instanceof Error?e.message:'Unable to upload document')}finally{setPending(false)}
  }
  return <section className="card p-6"><h2>Investigation documents</h2><p className="muted">Attach a PDF, PNG, or JPEG to a recorded visit or investigation. Files stay on this computer and are excluded from clinical reports.</p>
    {record.clinicalEvents.length===0?<p>Add a healthcare event before attaching a document.</p>:<form className="app-form mt-5" onSubmit={upload}><fieldset disabled={pending||!storage}><label>Related event<select required value={eventId} onChange={e=>setEventId(e.target.value)}><option value="">Choose an event</option>{record.clinicalEvents.map(e=><option key={e.id} value={e.id}>{e.date} · {e.label}</option>)}</select></label><label>Document (maximum 5 MB)<input type="file" accept="application/pdf,image/png,image/jpeg" onChange={e=>setFile(e.target.files?.[0]??null)}/></label><button className="secondary-button" disabled={!file||!eventId}>Save document</button></fieldset></form>}
    {message&&<p className="notice mt-4" role="status">{message}</p>}
    {documents.map(d=><div className="history-row" key={d.id}><span>{d.filename}<small>{record.clinicalEvents.find(e=>e.id===d.eventId)?.label}</small></span><button onClick={()=>void download(`/attachments/${d.id}`,d.filename).catch(e=>setMessage(e.message))}>Download</button>{storage&&<ConfirmRemove label="document" remove={async()=>{try{await api(`/attachments/${d.id}`,'DELETE',{});await refresh()}catch(e){setMessage(e instanceof Error?e.message:'Unable to remove document');throw e}}}/>}</div>)}
  </section>
}
