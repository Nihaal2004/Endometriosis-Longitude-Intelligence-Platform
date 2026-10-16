/**
 * Me — account, treatments & appointments, and data rights.
 *
 * Data rights are first-class here rather than buried: see and correct (the logs
 * themselves), download everything, change consent, delete everything. The
 * privacy notice promises each of these lives in this tab.
 */

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PERSONAS } from '../../data/personas'
import { destroyLocal } from '../../data/local'
import { deliverFile } from '../../native/files'
import { isNative } from '../../native/platform'
import { requestReminderPermission } from '../../native/reminders'
import { canUseAppLock, isAppLockEnabled, setAppLock } from '../../native/AppLock'
import { supabase } from '../../data/supabase'
import { getSymptom, symptomLabel } from '../../engine/symptoms'
import type { ClinicalEvent, ClinicalEventKind, TreatmentEpisode, TreatmentKind } from '../../engine/types'
import { formatDateLong } from '../../engine/brief'
import { useAuth } from '../auth/AuthProvider'
import { useData } from '../data'
import { CONSENT_PURPOSES, GRIEVANCE_CONTACT, NOTICE_VERSION } from '../privacy'
import { useApp, type ScreenTheme } from '../store'
import { PrivacyDialog } from '../PrivacyDialog'

const TREATMENT_KINDS: { id: TreatmentKind; label: string }[] = [
  { id: 'combined_oral_contraceptive', label: 'Combined pill' },
  { id: 'progestin', label: 'Progestin (e.g. norethisterone, dienogest)' },
  { id: 'gnrh', label: 'GnRH medication' },
  { id: 'iud', label: 'Hormonal IUD' },
  { id: 'pain_management', label: 'Pain management' },
  { id: 'physiotherapy', label: 'Physiotherapy' },
  { id: 'surgery', label: 'Surgery' },
  { id: 'fertility', label: 'Fertility treatment' },
  { id: 'other', label: 'Other' },
]

const EVENT_KINDS: { id: ClinicalEventKind; label: string }[] = [
  { id: 'gp', label: 'GP / doctor visit' },
  { id: 'gynaecology', label: 'Gynaecologist' },
  { id: 'emergency', label: 'Emergency visit' },
  { id: 'ultrasound', label: 'Ultrasound' },
  { id: 'mri', label: 'MRI' },
  { id: 'ct', label: 'CT scan' },
  { id: 'laparoscopy', label: 'Laparoscopy' },
  { id: 'surgery', label: 'Surgery' },
  { id: 'referral', label: 'Referral' },
  { id: 'diagnosis', label: 'Diagnosis given' },
  { id: 'fertility', label: 'Fertility consultation' },
  { id: 'admission', label: 'Hospital admission' },
]

export default function Me() {
  const { mode } = useData()
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 style={{ fontSize: 28 }}>Me</h1>
      {mode === 'demo' ? <DemoPanel /> : <AccountPanel />}
      {mode === 'account' && <ProfileCard />}
      {mode === 'account' && <RemindersAndLock />}
      <HealthHistory />
      {mode === 'account' && <DataRights />}
      <Appearance />
    </div>
  )
}

// ---------------------------------------------------------------------------

function Card({ title, children, sub }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 style={{ fontSize: 18 }}>{title}</h2>
      {sub && <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function DemoPanel() {
  const { demoPersonaId, setDemoPersona, exitDemo } = useApp()
  const navigate = useNavigate()
  return (
    <Card title="Demo patient" sub="Synthetic data. Anything you log stays in this browser and is never sent anywhere.">
      <div className="flex flex-wrap gap-2">
        {PERSONAS.map((p) => (
          <button key={p.id} type="button" className="chip focus-ring" data-selected={p.id === demoPersonaId}
            onClick={() => setDemoPersona(p.id)}>
            {p.name}, {p.age}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-ghost focus-ring mt-4"
        onClick={() => { exitDemo(); navigate('/login') }}>
        Leave the demo
      </button>
    </Card>
  )
}

function AccountPanel() {
  const { user } = useAuth()
  const { syncStatus, signOutSafely, repo } = useData()
  const navigate = useNavigate()
  const [unsyncedWarning, setUnsyncedWarning] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  async function signOut(force = false) {
    setBusy(true)
    const result = await signOutSafely(force)
    setBusy(false)
    if (result.signedOut) navigate('/login', { replace: true })
    else setUnsyncedWarning(result.unsynced)
  }

  const s = syncStatus
  const syncLine = !s
    ? '-'
    : s.syncing
      ? 'Syncing…'
      : s.pending > 0
        ? `${s.pending} change${s.pending === 1 ? '' : 's'} waiting to sync${s.offline ? ' (offline)' : ''}`
        : s.lastSyncedAt
          ? `All changes synced · ${new Date(s.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          : 'Saved on this device'

  return (
    <Card title="Account">
      <dl className="space-y-2 text-[14px]">
        <Row k="Email" v={user?.email ?? '-'} />
        <Row k="Sync" v={syncLine} />
        {s && s.rejected > 0 && (
          <p className="notice notice-error mt-2">
            {s.rejected} change{s.rejected === 1 ? ' was' : 's were'} rejected by the server and kept on this
            device. This usually means a value was out of range.
          </p>
        )}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 42 }}
          onClick={() => void repo?.sync()}>
          Sync now
        </button>
        <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 42 }}
          onClick={() => void signOut()} disabled={busy}>
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
      {unsyncedWarning !== null && (
        <div className="notice notice-error mt-4">
          <p>
            {unsyncedWarning} change{unsyncedWarning === 1 ? ' hasn’t' : 's haven’t'} reached the server yet.
            Signing out now removes {unsyncedWarning === 1 ? 'it' : 'them'} from this device for good.
            Connect to the internet first if you can.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-danger focus-ring" style={{ minHeight: 40 }}
              onClick={() => void signOut(true)}>
              Sign out anyway
            </button>
            <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 40 }}
              onClick={() => setUnsyncedWarning(null)}>
              Stay signed in
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

function ProfileCard() {
  const { profileRow, repo } = useData()
  const [name, setName] = useState(profileRow?.display_name ?? '')
  const [status, setStatus] = useState(profileRow?.diagnosis_status ?? 'undiagnosed')
  const [saved, setSaved] = useState(false)
  const dirty = name !== (profileRow?.display_name ?? '') || status !== profileRow?.diagnosis_status

  async function save() {
    await repo?.updateProfile({ display_name: name.trim() || null, diagnosis_status: status })
    setSaved(true)
  }

  return (
    <Card title="Profile" sub="Shown at the top of your report. Leave the name blank to keep the report anonymous.">
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="field-label">Name on your report</span>
          <input className="input" maxLength={60} value={name} placeholder="Optional"
            onChange={(e) => { setName(e.target.value); setSaved(false) }} />
        </label>
        <label>
          <span className="field-label">Diagnosis</span>
          <select className="input" value={status}
            onChange={(e) => { setStatus(e.target.value as typeof status); setSaved(false) }}>
            <option value="suspected">Suspected endometriosis</option>
            <option value="confirmed">Endometriosis confirmed</option>
            <option value="undiagnosed">Not yet diagnosed</option>
          </select>
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 42 }}
          onClick={() => void save()} disabled={!dirty}>
          Save profile
        </button>
        {saved && <span className="text-[13px]" style={{ color: 'var(--sage)' }}>Saved</span>}
      </div>
    </Card>
  )
}

function RemindersAndLock() {
  const { profileRow, repo } = useData()
  const pref = profileRow?.reminder ?? 'daily'
  const [time, setTime] = useState((profileRow?.reminder_time ?? '20:00').slice(0, 5))
  const [lockOn, setLockOn] = useState<boolean | null>(null)
  const [lockAvailable, setLockAvailable] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!isNative) return
    void isAppLockEnabled().then(setLockOn)
    void canUseAppLock().then(setLockAvailable)
  }, [])

  async function choose(next: 'daily' | 'period' | 'none') {
    setMessage(null)
    if (next !== 'none' && isNative && !(await requestReminderPermission())) {
      setMessage('Notifications are turned off for MedTrace in your phone’s settings.')
    }
    await repo?.updateProfile({ reminder: next })
  }

  async function toggleLock(next: boolean) {
    setMessage(null)
    const ok = await setAppLock(next)
    if (ok) setLockOn(next)
    else if (next) setMessage('Couldn’t confirm it’s you, so the lock wasn’t turned on.')
  }

  return (
    <Card title="Reminders" sub="Reminders only ever say “Your check-in is ready”. No streaks, no messages about missed days.">
      <div className="segmented" role="tablist" aria-label="Reminder frequency">
        {([['daily', 'Every day'], ['period', 'During my period'], ['none', 'Off']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={pref === id} className="focus-ring"
            onClick={() => void choose(id)}>
            {label}
          </button>
        ))}
      </div>
      {pref !== 'none' && (
        <label className="mt-4 block max-w-[180px]">
          <span className="field-label">Time</span>
          <input className="input" type="time" value={time}
            onChange={(e) => setTime(e.target.value)}
            onBlur={() => void repo?.updateProfile({ reminder_time: time })} />
        </label>
      )}
      {pref === 'period' && (
        <p className="mt-3 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          Reminds you the evening after a day you logged bleeding, until bleeding stops. MedTrace doesn’t predict
          when your period will come.
        </p>
      )}
      {!isNative && pref !== 'none' && (
        <p className="mt-3 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          Reminders are delivered by the phone app.
        </p>
      )}

      {isNative && lockAvailable && lockOn !== null && (
        <label className="mt-6 flex items-start justify-between gap-4 rounded-xl px-4 py-3" style={{ background: 'var(--surface-sunken)' }}>
          <span>
            <span className="block text-[14px] font-semibold">Lock the app</span>
            <span className="block text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
              Ask for your fingerprint, face or phone PIN when MedTrace opens.
            </span>
          </span>
          <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" style={{ accentColor: 'var(--ink)' }}
            checked={lockOn} onChange={(e) => void toggleLock(e.target.checked)} />
        </label>
      )}
      {message && <p className="notice notice-error mt-3">{message}</p>}
    </Card>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt style={{ color: 'var(--ink-muted)' }}>{k}</dt>
      <dd className="text-right" style={{ color: 'var(--ink)' }}>{v}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Treatments and appointments
// ---------------------------------------------------------------------------

function HealthHistory() {
  const { record, repo, mode, customLabels, today } = useData()
  const [editingTreatment, setEditingTreatment] = useState<TreatmentEpisode | 'new' | null>(null)
  const [editingEvent, setEditingEvent] = useState<ClinicalEvent | 'new' | null>(null)
  const readOnly = mode !== 'account'

  const treatments = [...record.treatments].sort((a, b) => b.startDate.localeCompare(a.startDate))
  const events = [...record.clinicalEvents].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <Card title="Treatments & appointments"
      sub="These appear on your timeline and in your report, so a clinician sees what has already been tried.">
      <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)', fontFamily: 'var(--font-ui)' }}>
        Treatments
      </h3>
      {treatments.length === 0 && <Empty>No treatments recorded.</Empty>}
      <ul className="space-y-2">
        {treatments.map((t) => (
          <li key={t.id}>
            {editingTreatment !== 'new' && editingTreatment?.id === t.id ? (
              <TreatmentForm initial={t} today={today} customLabels={customLabels} onDone={() => setEditingTreatment(null)} />
            ) : (
              <ItemRow
                title={t.label}
                sub={`${formatDateLong(t.startDate)} → ${t.endDate ? formatDateLong(t.endDate) : 'ongoing'}${t.indicationSymptomId ? ` · for ${symptomLabel(t.indicationSymptomId, customLabels).toLowerCase()}` : ''}`}
                onEdit={readOnly ? undefined : () => setEditingTreatment(t)}
                onDelete={readOnly ? undefined : () => void repo?.deleteTreatment(t.id)}
              />
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (editingTreatment === 'new' ? (
        <TreatmentForm today={today} customLabels={customLabels} onDone={() => setEditingTreatment(null)} />
      ) : (
        <button type="button" className="link mt-3 text-[14px]" onClick={() => setEditingTreatment('new')}>
          + Add a treatment
        </button>
      ))}

      <h3 className="mb-2 mt-7 text-[13px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)', fontFamily: 'var(--font-ui)' }}>
        Appointments & tests
      </h3>
      {events.length === 0 && <Empty>No appointments recorded.</Empty>}
      <ul className="space-y-2">
        {events.map((e) => (
          <li key={e.id}>
            {editingEvent !== 'new' && editingEvent?.id === e.id ? (
              <EventForm initial={e} today={today} onDone={() => setEditingEvent(null)} />
            ) : (
              <ItemRow
                title={e.label}
                sub={`${formatDateLong(e.date)}${e.outcome ? ` · ${e.outcome}` : ''}`}
                onEdit={readOnly ? undefined : () => setEditingEvent(e)}
                onDelete={readOnly ? undefined : () => void repo?.deleteEvent(e.id)}
              />
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (editingEvent === 'new' ? (
        <EventForm today={today} onDone={() => setEditingEvent(null)} />
      ) : (
        <button type="button" className="link mt-3 text-[14px]" onClick={() => setEditingEvent('new')}>
          + Add an appointment or test
        </button>
      ))}
    </Card>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13.5px]" style={{ color: 'var(--ink-muted)' }}>{children}</p>
}

function ItemRow({ title, sub, onEdit, onDelete }: { title: string; sub: string; onEdit?: () => void; onDelete?: () => void }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: 'var(--surface-sunken)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14.5px] font-semibold" style={{ color: 'var(--ink)' }}>{title}</p>
          <p className="text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>{sub}</p>
        </div>
        {(onEdit || onDelete) && (
          <div className="flex shrink-0 gap-3 text-[13px]">
            {onEdit && <button type="button" className="link" onClick={onEdit}>Edit</button>}
            {onDelete && !confirm && <button type="button" className="link" onClick={() => setConfirm(true)}>Remove</button>}
            {onDelete && confirm && (
              <>
                <button type="button" className="link" style={{ color: 'var(--viz-critical)' }} onClick={onDelete}>Confirm</button>
                <button type="button" className="link" onClick={() => setConfirm(false)}>Cancel</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TreatmentForm({
  initial, today, customLabels, onDone,
}: {
  initial?: TreatmentEpisode
  today: string
  customLabels: Record<string, string>
  onDone: () => void
}) {
  const { repo, record } = useData()
  const [kind, setKind] = useState<TreatmentKind>(initial?.kind ?? 'progestin')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [start, setStart] = useState(initial?.startDate ?? today)
  const [end, setEnd] = useState(initial?.endDate ?? '')
  const [dose, setDose] = useState(initial?.dose ?? '')
  const [indication, setIndication] = useState(initial?.indicationSymptomId ?? '')
  const [change, setChange] = useState(initial?.patientPerceivedChange ?? '')
  const [error, setError] = useState<string | null>(null)

  const symptomOptions = record.trackedSymptomIds
    .filter((id) => !getSymptom(id)?.sensitive || record.profile.enabledDomains.includes('sexual'))
    .map((id) => ({ id, label: symptomLabel(id, customLabels) }))

  async function save() {
    if (!label.trim()) return setError('Give the treatment a name, e.g. “Dienogest 2 mg”.')
    if (end && end < start) return setError('The end date is before the start date.')
    await repo?.saveTreatment({
      id: initial?.id,
      kind,
      label: label.trim(),
      startDate: start,
      endDate: end || undefined,
      dose: dose || undefined,
      indicationSymptomId: indication || undefined,
      reason: indication ? `For ${symptomLabel(indication, customLabels).toLowerCase()}` : initial?.reason,
      sideEffects: initial?.sideEffects,
      patientPerceivedChange: (change || undefined) as TreatmentEpisode['patientPerceivedChange'],
    })
    onDone()
  }

  return (
    <div className="mt-2 rounded-xl p-4" style={{ border: '1px solid var(--hairline-strong)' }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="field-label">Name</span>
          <input className="input" value={label} maxLength={120} placeholder="e.g. Dienogest 2 mg" onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label>
          <span className="field-label">Type</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as TreatmentKind)}>
            {TREATMENT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>
        <label>
          <span className="field-label">Dose (optional)</span>
          <input className="input" value={dose} maxLength={120} onChange={(e) => setDose(e.target.value)} />
        </label>
        <label>
          <span className="field-label">Started</span>
          <input className="input" type="date" value={start} max={today} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          <span className="field-label">Stopped (leave blank if ongoing)</span>
          <input className="input" type="date" value={end} max={today} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="sm:col-span-2">
          <span className="field-label">What was it prescribed for?</span>
          <select className="input" value={indication} onChange={(e) => setIndication(e.target.value)}>
            <option value="">Not sure / not one symptom</option>
            {symptomOptions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <span className="mt-1 block text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            This lets your report check whether that symptom changed once you started.
          </span>
        </label>
        <label className="sm:col-span-2">
          <span className="field-label">How do you feel it’s going? (optional)</span>
          <select className="input" value={change} onChange={(e) => setChange(e.target.value as typeof change)}>
            <option value="">-</option>
            <option value="better">Better</option>
            <option value="unchanged">No change</option>
            <option value="worse">Worse</option>
            <option value="unsure">Not sure</option>
          </select>
        </label>
      </div>
      {error && <p className="notice notice-error mt-3">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn btn-primary focus-ring" style={{ minHeight: 42 }} onClick={() => void save()}>Save</button>
        <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 42 }} onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}

function EventForm({ initial, today, onDone }: { initial?: ClinicalEvent; today: string; onDone: () => void }) {
  const { repo } = useData()
  const [kind, setKind] = useState<ClinicalEventKind>(initial?.kind ?? 'gp')
  const [date, setDate] = useState(initial?.date ?? today)
  const [label, setLabel] = useState(initial?.label ?? '')
  const [reason, setReason] = useState(initial?.reason ?? '')
  const [outcome, setOutcome] = useState(initial?.outcome ?? '')

  async function save() {
    const fallback = EVENT_KINDS.find((k) => k.id === kind)?.label ?? 'Appointment'
    await repo?.saveEvent({
      id: initial?.id,
      kind,
      date,
      label: label.trim() || fallback,
      reason: reason || undefined,
      outcome: outcome || undefined,
      note: initial?.note,
    })
    onDone()
  }

  return (
    <div className="mt-2 rounded-xl p-4" style={{ border: '1px solid var(--hairline-strong)' }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="field-label">What kind?</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as ClinicalEventKind)}>
            {EVENT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>
        <label>
          <span className="field-label">Date</span>
          <input className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="sm:col-span-2">
          <span className="field-label">Title (optional)</span>
          <input className="input" value={label} maxLength={120} placeholder="e.g. Pelvic ultrasound" onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="sm:col-span-2">
          <span className="field-label">Why did you go? (optional)</span>
          <input className="input" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="sm:col-span-2">
          <span className="field-label">What happened? (optional)</span>
          <input className="input" value={outcome} maxLength={500} placeholder="e.g. No abnormality found; referred to gynaecology" onChange={(e) => setOutcome(e.target.value)} />
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn btn-primary focus-ring" style={{ minHeight: 42 }} onClick={() => void save()}>Save</button>
        <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 42 }} onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Data rights (DPDP): download, consent, erasure
// ---------------------------------------------------------------------------

interface ConsentState {
  purpose: string
  granted: boolean
  recorded_at: string
}

function DataRights() {
  const { user } = useAuth()
  const { repo } = useData()
  const navigate = useNavigate()
  const [consents, setConsents] = useState<ConsentState[] | null>(null)
  const [exporting, setExporting] = useState(false)
  const [deleteText, setDeleteText] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [showNotice, setShowNotice] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadConsents = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.from('current_consents').select('purpose, granted, recorded_at')
    setConsents((data as ConsentState[]) ?? [])
  }, [])

  useEffect(() => {
    void loadConsents()
  }, [loadConsents])

  async function setConsent(purpose: (typeof CONSENT_PURPOSES)[number]['id'], granted: boolean) {
    if (!repo) return
    await repo.recordConsent(purpose, granted, NOTICE_VERSION)
    if (purpose === 'sexual_health_module') {
      const profile = await repo.getProfileRow()
      const domains = new Set(profile.enabled_domains)
      if (granted) domains.add('sexual')
      else domains.delete('sexual')
      await repo.updateProfile({ enabled_domains: [...domains] })
    }
    await repo.sync()
    await loadConsents()
  }

  async function exportData() {
    if (!supabase || !repo) return
    setExporting(true)
    setError(null)
    try {
      await repo.sync()
      const tables = ['profiles', 'day_entries', 'day_entry_revisions', 'treatments', 'clinical_events',
        'custom_symptoms', 'consents', 'share_grants', 'audit_events'] as const
      const out: Record<string, unknown> = {
        exported_at: new Date().toISOString(),
        account_email: user?.email,
        note: 'Everything MedTrace holds for this account. Share tokens are not included because only their hashes are stored.',
      }
      for (const t of tables) {
        const { data, error: e } = await supabase.from(t).select('*')
        if (e) throw e
        out[t] = t === 'share_grants'
          ? (data ?? []).map(({ token_hash: _h, ...rest }: Record<string, unknown>) => { void _h; return rest })
          : data
      }
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
      await deliverFile(`medtrace-export-${new Date().toISOString().slice(0, 10)}.json`, blob, 'Your MedTrace data')
      await repo.audit('data_exported')
    } catch {
      setError('Couldn’t download your data. Check your connection and try again.')
    } finally {
      setExporting(false)
    }
  }

  async function deleteAccount() {
    if (!supabase || !user) return
    setError(null)
    const { error: e } = await supabase.rpc('delete_my_account')
    if (e) return setError('Couldn’t delete your account. Check your connection and try again.')
    // The user and their server sessions are already gone. supabase-js still calls
    // /logout, gets a 403 for the missing user, treats that as success, and clears
    // the local session — the 403 in the network log is expected. Signing out before
    // deleting the local store also tears down the repository first.
    const uid = user.id
    await supabase.auth.signOut({ scope: 'local' })
    await destroyLocal(uid)
    navigate('/login', { replace: true })
  }

  const granted = (purpose: string) => consents?.find((c) => c.purpose === purpose)?.granted ?? false

  return (
    <Card title="Your data" sub="Everything here is yours to download, change, or erase.">
      <h3 className="mb-2 text-[14px] font-semibold">Consent</h3>
      <div className="space-y-2">
        {CONSENT_PURPOSES.filter((p) => !p.required).map((p) => (
          <label key={p.id} className="flex items-start justify-between gap-4 rounded-xl px-4 py-3"
            style={{ background: 'var(--surface-sunken)' }}>
            <span>
              <span className="block text-[14px] font-semibold">{p.title}</span>
              <span className="block text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>{p.body}</span>
            </span>
            <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" style={{ accentColor: 'var(--ink)' }}
              checked={granted(p.id)} disabled={consents === null}
              onChange={(e) => void setConsent(p.id, e.target.checked)} />
          </label>
        ))}
      </div>
      <p className="mt-2 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
        Keeping your symptom record is what the app is for. To withdraw that consent, delete your account below.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost focus-ring" onClick={() => void exportData()} disabled={exporting}>
          {exporting ? 'Preparing…' : 'Download all my data'}
        </button>
        <button type="button" className="btn btn-ghost focus-ring" onClick={() => setShowNotice(true)}>Privacy notice</button>
        <PrivacyDialog open={showNotice} onClose={() => setShowNotice(false)} />
      </div>

      <div className="mt-6 rounded-xl p-4" style={{ border: '1px solid color-mix(in srgb, var(--viz-critical) 35%, transparent)' }}>
        <h3 className="text-[14px] font-semibold">Delete my account</h3>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
          Permanently erases your account, every entry and its history, your reports and share links. This can’t be undone.
        </p>
        {!deleteOpen ? (
          <button type="button" className="btn btn-danger focus-ring mt-3" style={{ minHeight: 42 }} onClick={() => setDeleteOpen(true)}>
            Delete account…
          </button>
        ) : (
          <div className="mt-3">
            <label className="field-label" htmlFor="confirm-delete">Type DELETE to confirm</label>
            <input id="confirm-delete" className="input" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} autoComplete="off" />
            <div className="mt-3 flex gap-2">
              <button type="button" className="btn btn-danger focus-ring" style={{ minHeight: 42 }}
                disabled={deleteText !== 'DELETE'} onClick={() => void deleteAccount()}>
                Permanently delete
              </button>
              <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 42 }}
                onClick={() => { setDeleteOpen(false); setDeleteText('') }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="notice notice-error mt-4">{error}</p>}

      {GRIEVANCE_CONTACT && (
        <p className="mt-5 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          Questions or complaints: {GRIEVANCE_CONTACT.name}, {GRIEVANCE_CONTACT.email}
        </p>
      )}
    </Card>
  )
}

function Appearance() {
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const options: { id: ScreenTheme; label: string }[] = [
    { id: 'system', label: 'Match device' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ]
  return (
    <Card title="Appearance">
      <div className="segmented" role="tablist">
        {options.map((o) => (
          <button key={o.id} type="button" role="tab" aria-selected={theme === o.id} className="focus-ring"
            onClick={() => setTheme(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </Card>
  )
}
