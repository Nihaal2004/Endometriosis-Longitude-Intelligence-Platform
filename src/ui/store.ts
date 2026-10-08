import { create } from 'zustand'
import { PERSONAS } from '../data/personas'
import { buildFeatureContext, defaultWindow } from '../engine/features'
import { runPatternEngine } from '../engine/patterns'
import { generateBrief, DEFAULT_BRIEF_CONFIG } from '../engine/brief'
import { applyFidelityGate, verifyBrief } from '../engine/fidelity'
import type { DayRecord, PatientRecord } from '../engine/types'

export type ScreenTheme = 'light' | 'dark' | 'system'
export interface LocalUser { username: string | null; kind: 'local' | 'trial' }
export interface SessionData { user: LocalUser | null; csrfToken?: string; id?: string; revision?: number; record?: PatientRecord; consents?: Record<string, boolean>; recoveryCode?: string }
let csrf = ''
export function localDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const payload = body === undefined ? undefined : JSON.stringify(body)
  const timeoutMs = path === '/reports/preview' ? 75000 : 20000
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-MedTrace-Client': 'local-app', 'X-CSRF-Token': csrf }, body: payload })
    if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('Local server unavailable. Start npm run api and reconnect.')
    const value = await response.json()
    if (response.status === 401) { csrf = ''; useApp.setState({ user: null, ready: true }); throw new Error(value.error) }
    if (!response.ok) {
      if (path === '/auth/session' && response.status === 403) {
        const reason = typeof value.error === 'string' ? value.error : 'Session request rejected'
        throw new Error(`${reason}. Stop the old API and restart npm run api, then restart npm run dev and open http://127.0.0.1:5173.`)
      }
      throw new Error(value.error ?? 'Unable to complete this request')
    }
    return value
  } catch (e) { if (e instanceof TypeError || (e instanceof DOMException && e.name === 'AbortError')) throw new Error('Cannot reach the local server. Your draft has not been saved; reconnect before closing this page.'); throw e }
  finally { window.clearTimeout(timer) }
}
export async function download(path: string, filename: string) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin' })
  if (!response.ok) { const error = await response.json(); throw new Error(error.error ?? 'Download failed') }
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
interface AppState {
  user: LocalUser | null; record: PatientRecord | null; personaId: string; demoId: string
  ready: boolean; busy: boolean; error: string; status: string; revision: number; generation: number
  selectedDate: string; windowDays: number; theme: ScreenTheme; consents: Record<string, boolean>; recoveryCode: string
  initialize: () => Promise<void>; authenticate: (mode: 'login' | 'register' | 'recover', body: unknown) => Promise<void>
  startTrial: (id: string) => Promise<void>; selectDemo: (id: string) => Promise<void>; logout: () => Promise<void>
  saveRecord: (record: PatientRecord) => Promise<void>; createPatient: (record: PatientRecord) => Promise<void>
  upsertDay: (day: DayRecord) => Promise<void>; setConsent: (purpose: string, granted: boolean) => Promise<void>
  setDate: (date: string) => void; setWindowDays: (days: number) => void; setTheme: (theme: ScreenTheme) => void
  acceptSession: (session: SessionData) => void; clearRecovery: () => void
}
const clean = (record: PatientRecord) => { const { groundTruth, ...rest } = record; return { ...rest, days: record.days.filter(d => d.logged) } }
let initialization: Promise<void> | null = null
export const useApp = create<AppState>((set, get) => {
  const acceptSession = (session: SessionData) => {
    csrf = session.csrfToken ?? ''
    set({ user: session.user, record: session.record ?? null, personaId: session.id ?? '',
      demoId: session.user?.kind === 'trial' ? (PERSONAS.find(p=>p.record.profile.displayName===session.record?.profile.displayName)?.id ?? '') : '',
      revision: session.revision ?? 0, consents: session.consents ?? {}, ready: true,
      generation: get().generation + 1, recoveryCode: session.user ? (session.recoveryCode ?? get().recoveryCode) : '', error: '' })
  }
  const operation = async (fn: () => Promise<void>) => {
    if (get().busy) throw new Error('Please wait for the current save to finish')
    set({ busy: true, error: '', status: '' })
    try { await fn() } catch (e) { set({ error: e instanceof Error ? e.message : 'Local operation failed' }); throw e }
    finally { set({ busy: false }) }
  }
  return {
    user: null, record: null, personaId: '', demoId: '', ready: false, busy: false, error: '', status: '',
    revision: 0, generation: 0, selectedDate: localDate(), windowDays: 92, theme: 'light', consents: {}, recoveryCode: '',
    acceptSession,
    initialize: () => {
      if (initialization) return initialization
      initialization = operation(async () => { acceptSession(await api('/auth/session')) }).catch(() => {}).finally(() => { initialization = null })
      return initialization
    },
    authenticate: (mode, body) => operation(async () => { acceptSession(await api(`/auth/${mode}`, 'POST', body)); set({ demoId: '', selectedDate: localDate() }) }),
    startTrial: (id) => operation(async () => {
      const persona = PERSONAS.find(p => p.id === id)!
      acceptSession(await api('/auth/trial', 'POST', { record: clean(persona.record), accepted: true }))
      set({ demoId: id, selectedDate: persona.record.days.at(-1)?.date ?? localDate() })
    }),
    selectDemo: (id) => operation(async () => {
      const persona = PERSONAS.find(p => p.id === id)!
      acceptSession(await api('/trial/scenario', 'POST', { record: clean(persona.record), requestId: crypto.randomUUID() }))
      set({ demoId: id, selectedDate: persona.record.days.at(-1)?.date ?? localDate() })
    }),
    logout: () => operation(async () => { await api('/auth/logout', 'POST', {}); acceptSession({ user: null }); set({ demoId: '', selectedDate: localDate() }) }),
    saveRecord: (record) => operation(async () => {
      const result = await api<SessionData>('/record', 'PUT', { record: clean(record), revision: get().revision, requestId: crypto.randomUUID() })
      set({ record: result.record!, revision: result.revision!, consents: result.consents!, status: 'Your changes are saved.' })
    }),
    createPatient: (record) => get().saveRecord(record),
    upsertDay: async (day) => {
      const record = get().record!
      await get().saveRecord({ ...record, days: [...record.days.filter(d => d.date !== day.date), day].sort((a, b) => a.date.localeCompare(b.date)),
        trackedSymptomIds: [...new Set([...record.trackedSymptomIds, ...Object.keys(day.symptoms)])] })
    },
    setConsent: (purpose, granted) => operation(async () => { acceptSession(await api('/consents', 'POST', { purpose, granted })); set({ status: 'Privacy preference updated.' }) }),
    setDate: (selectedDate) => { if (!get().busy) set({ selectedDate }) }, setWindowDays: (windowDays) => set({ windowDays }),
    setTheme: (theme) => set({ theme }), clearRecovery: () => set({ recoveryCode: '' }),
  }
})
function compute(record: PatientRecord, days: number) {
  const labels = Object.fromEntries((record.customSymptoms ?? []).map(s => [s.id, s.label]))
  const ctx = buildFeatureContext(record, defaultWindow(record, days))
  const patterns = runPatternEngine(ctx)
  const brief = generateBrief(ctx, patterns.findings, patterns.suppressed, { ...DEFAULT_BRIEF_CONFIG, customLabels: labels })
  const fidelity = verifyBrief(brief.claims, record, brief.windowStart, brief.windowEnd)
  const { kept, rejected } = applyFidelityGate(brief.claims, fidelity)
  return { ctx, patterns, brief, fidelity, verifiedClaims: kept, rejectedClaims: rejected }
}
let cache: { record: PatientRecord; days: number; value: ReturnType<typeof compute> } | null = null
export function useAnalysis() {
  const record = useApp(s => s.record)!
  const days = useApp(s => s.windowDays)
  if (!cache || cache.record !== record || cache.days !== days) cache = { record, days, value: compute(record, days) }
  return cache.value
}
export function useRecord() { return useApp(s => s.record)! }
export function useCustomLabels(): Record<string, string> { const record = useRecord(); return Object.fromEntries((record.customSymptoms ?? []).map(s => [s.id, s.label])) }
