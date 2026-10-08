import { useState } from 'react'
import { useApp, useRecord, localDate } from '../store'
import { symptomDefinitions } from '../records'
import Attachments from '../Attachments'
import type { ClinicalEvent, ClinicalEventKind, TreatmentEpisode, TreatmentKind } from '../../engine/types'
import ConfirmRemove from '../ConfirmRemove'

const EVENT_KINDS: ClinicalEventKind[] = ['gp', 'gynaecology', 'emergency', 'referral', 'ultrasound', 'mri', 'ct', 'laparoscopy', 'surgery', 'diagnosis', 'fertility', 'admission']
const TREATMENT_KINDS: TreatmentKind[] = ['combined_oral_contraceptive', 'progestin', 'gnrh', 'iud', 'physiotherapy', 'pain_management', 'surgery', 'fertility', 'other']
const label = (s: string) => s.replaceAll('_', ' ')
export default function Events() {
  const record = useRecord()
  const busy = useApp(s => s.busy)
  const [event, setEvent] = useState<ClinicalEvent>({ id: crypto.randomUUID(), kind: 'gp', date: localDate(), label: '' })
  const [treatment, setTreatment] = useState<TreatmentEpisode>({ id: crypto.randomUUID(), kind: 'pain_management', startDate: localDate(), label: '' })
  const [message, setMessage] = useState('')
  async function saveEvent(e: React.FormEvent) {
    e.preventDefault()
    try {
      await useApp.getState().saveRecord({ ...record, clinicalEvents: [...record.clinicalEvents.filter(v => v.id !== event.id), event] })
      setEvent({ id: crypto.randomUUID(), kind: 'gp', date: localDate(), label: '' }); setMessage('Healthcare event saved. Timeline and brief updated.')
    } catch {}
  }
  async function saveTreatment(e: React.FormEvent) {
    e.preventDefault()
    try {
      await useApp.getState().saveRecord({ ...record, treatments: [...record.treatments.filter(v => v.id !== treatment.id), treatment] })
      setTreatment({ id: crypto.randomUUID(), kind: 'pain_management', startDate: localDate(), label: '' }); setMessage('Treatment saved. Analysis, timeline, and brief updated.')
    } catch {}
  }
  return <div className="space-y-5"><h1>Treatments & healthcare events</h1>
    <p>Add or edit the events that give your symptom history context.</p>
    {message && <p role="status">{message}</p>}
    <div className="mvp-grid">
      <form className="card mvp-form p-5" onSubmit={saveTreatment}><fieldset disabled={busy} className="mvp-lock"><h2>Treatment</h2>
        <label>Name<input required value={treatment.label} onChange={e => setTreatment(t => ({ ...t, label: e.target.value }))} /></label>
        <label>Type<select value={treatment.kind} onChange={e => setTreatment(t => ({ ...t, kind: e.target.value as TreatmentKind }))}>{TREATMENT_KINDS.map(k => <option key={k} value={k}>{label(k)}</option>)}</select></label>
        <div className="mvp-grid"><label>Start date<input type="date" required value={treatment.startDate} onChange={e => setTreatment(t => ({ ...t, startDate: e.target.value }))} /></label>
          <label>End date (optional)<input type="date" min={treatment.startDate} value={treatment.endDate ?? ''} onChange={e => setTreatment(t => ({ ...t, endDate: e.target.value || undefined }))} /></label></div>
        <label>Dose / schedule<input value={treatment.dose ?? ''} onChange={e => setTreatment(t => ({ ...t, dose: e.target.value }))} /></label>
        <label>Reason<input value={treatment.reason ?? ''} onChange={e => setTreatment(t => ({ ...t, reason: e.target.value }))} /></label>
        <label>Target symptom<select value={treatment.indicationSymptomId ?? ''} onChange={e => setTreatment(t => ({ ...t, indicationSymptomId: e.target.value || undefined }))}><option value="">Unspecified</option>{symptomDefinitions(record).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label>Side effects<input value={treatment.sideEffects?.join(', ') ?? ''} onChange={e => setTreatment(t => ({ ...t, sideEffects: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} /></label>
        <label>Perceived change<select value={treatment.patientPerceivedChange ?? 'unsure'} onChange={e => setTreatment(t => ({ ...t, patientPerceivedChange: e.target.value as TreatmentEpisode['patientPerceivedChange'] }))}>{['unsure', 'better', 'unchanged', 'worse'].map(v => <option key={v}>{v}</option>)}</select></label>
        <button disabled={busy} className="mvp-primary">Save treatment</button>
      </fieldset></form>
      <form className="card mvp-form p-5" onSubmit={saveEvent}><fieldset disabled={busy} className="mvp-lock"><h2>Healthcare event</h2>
        <label>Event name<input required value={event.label} onChange={e => setEvent(v => ({ ...v, label: e.target.value }))} /></label>
        <label>Type<select value={event.kind} onChange={e => setEvent(v => ({ ...v, kind: e.target.value as ClinicalEventKind }))}>{EVENT_KINDS.map(k => <option key={k} value={k}>{label(k)}</option>)}</select></label>
        <label>Date<input required type="date" value={event.date} onChange={e => setEvent(v => ({ ...v, date: e.target.value }))} /></label>
        <label>Reason<textarea value={event.reason ?? ''} onChange={e => setEvent(v => ({ ...v, reason: e.target.value }))} /></label>
        <label>Outcome<textarea value={event.outcome ?? ''} onChange={e => setEvent(v => ({ ...v, outcome: e.target.value }))} /></label>
        <button disabled={busy} className="mvp-primary">Save healthcare event</button>
      </fieldset></form>
    </div>
    <section className="card p-5"><h2>Recorded treatments</h2>{record.treatments.length === 0 && <p>No treatments recorded yet.</p>}
      {record.treatments.map(t => <div className="mvp-row" key={t.id}><span>{t.startDate} · {t.label} {t.endDate ? `→ ${t.endDate}` : '(ongoing)'}</span><button disabled={busy} onClick={() => { setTreatment(t); setMessage('Treatment loaded for editing.') }}>Edit</button><ConfirmRemove label="treatment" remove={() => useApp.getState().saveRecord({ ...record, treatments: record.treatments.filter(v => v.id !== t.id) })} /></div>)}
      <h2 className="mt-5">Healthcare events</h2>{record.clinicalEvents.length === 0 && <p>No healthcare events recorded yet.</p>}
      {[...record.clinicalEvents].sort((a, b) => a.date.localeCompare(b.date)).map(v => <div className="mvp-row" key={v.id}><span>{v.date} · {v.label}</span><button disabled={busy} onClick={() => { setEvent(v); setMessage('Event loaded for editing.') }}>Edit</button><ConfirmRemove label="event" remove={() => useApp.getState().saveRecord({ ...record, clinicalEvents: record.clinicalEvents.filter(e => e.id !== v.id) })} /></div>)}
    </section>
    <Attachments />
  </div>
}
