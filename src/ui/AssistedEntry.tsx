import { useState } from 'react'
import type { PatientRecord, SymptomObservation } from '../engine/types'
import { symptomDefinitions } from './records'
// Conservative, local phrase matching. Suggestions never become observations until confirmed.
const ALIASES:Record<string,string[]>= {pelvic_pain:['pelvic pain','pelvic cramps'],menstrual_pain:['period pain','menstrual pain'],fatigue:['fatigue','tired','exhausted'],bloating:['bloating','bloated'],lower_back_pain:['back pain'],painful_bm:['pain opening bowels','painful bowel movement'],dysuria:['pain urinating','painful urination']}
export default function AssistedEntry({record,confirm}:{record:PatientRecord;confirm:(suggestions:Record<string,SymptomObservation>)=>void}) {
  const [text,setText]=useState('')
  const [suggestions,setSuggestions]=useState<{id:string;label:string;observation:SymptomObservation;selected:boolean}[]>([])
  const [parsed,setParsed]=useState(false)
  function extract() {
    const sentences=text.toLowerCase().split(/[.!?;\n]+/)
    const candidates=symptomDefinitions(record).filter(s=>record.profile.enabledDomains.includes(s.domain)&&!s.archived).flatMap(s=>{
      const terms=[s.label.toLowerCase(),...(ALIASES[s.id]??[])]
      const sentence=sentences.find(line=>terms.some(term=>line.includes(term)))
      if(!sentence)return []
      const term=terms.find(term=>sentence.includes(term))!
      const prefix=sentence.slice(0,sentence.indexOf(term)).trim()
      const absent=/(?:no|without|not having)\s*$/.test(prefix)
      const severity=sentence.match(/\b(10|[1-9])\s*(?:\/\s*10|out of 10)\b/)
      return [{id:s.id,label:s.label,observation:{state:absent?'absent':'present',severity:!absent&&s.graded&&severity?Number(severity[1]):undefined} as SymptomObservation,selected:true}]
    })
    setSuggestions(candidates);setParsed(true)
  }
  return <details className="assisted-entry"><summary>Prefer to describe your day in words?</summary><p className="muted">Local phrase matching suggests answers from what you type. Review every suggestion; unclear symptoms stay unanswered.</p><label>Your description<textarea maxLength={3000} value={text} onChange={e=>{setText(e.target.value);setParsed(false);setSuggestions([])}} placeholder="For example: pelvic pain 6/10; no bloating; feeling tired."/></label><button type="button" className="secondary-button" disabled={!text.trim()} onClick={extract}>Suggest answers</button>
    {parsed&&suggestions.length===0&&<p>No clear symptom phrases found. Please use the structured questions.</p>}
    {suggestions.map((s,i)=><label className="inline-check" key={s.id}><input type="checkbox" checked={s.selected} onChange={e=>setSuggestions(v=>v.map((item,n)=>n===i?{...item,selected:e.target.checked}:item))}/>{s.label}: {s.observation.state}{s.observation.severity?` · ${s.observation.severity}/10`:''}</label>)}
    {suggestions.length>0&&<button className="secondary-button" type="button" onClick={()=>{confirm(Object.fromEntries(suggestions.filter(s=>s.selected).map(s=>[s.id,s.observation])));setSuggestions([]);setParsed(false);setText('')}}>Confirm selected answers</button>}
  </details>
}
