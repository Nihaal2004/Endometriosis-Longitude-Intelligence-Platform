/**
 * data.tsx — one data interface for every screen.
 *
 * A screen never needs to know whether it is showing a real account or a demo
 * persona. It calls useData() and gets the record, today's date, the analysis
 * window, and save/clear actions. In account mode those go through the
 * repository (on-device store + sync); in demo mode they stay in the browser.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CUSTOM_LABELS } from '../data/personas'
import { destroyLocal, openLocal } from '../data/local'
import { supabaseRemote } from '../data/remote'
import { Repository, defaultProfileRow, type SyncStatus } from '../data/repository'
import type { ProfileRow } from '../data/mappers'
import { supabase } from '../data/supabase'
import { addDays, daysBetween } from '../engine/cycles'
import { defaultWindow, type AnalysisWindow } from '../engine/features'
import type { DayRecord, PatientRecord } from '../engine/types'
import { localToday } from '../lib/dates'
import { syncReminders } from '../native/reminders'
import { useAuth } from './auth/AuthProvider'
import { analyse, buildDemoRecord, useApp, type Analysis } from './store'

export type DataMode = 'account' | 'demo' | 'none'

interface DataContextValue {
  mode: DataMode
  /** False while the on-device store is opening for a signed-in account. */
  ready: boolean
  record: PatientRecord
  profileRow: ProfileRow | null
  /** False on a fresh device until the account's profile has been downloaded. */
  profileKnown: boolean
  customLabels: Record<string, string>
  /** "Today" on the patient's calendar (demo: the last day of the persona's data). */
  today: string
  window: AnalysisWindow
  revision: number
  repo: Repository | null
  syncStatus: SyncStatus | null
  saveDay(day: DayRecord): Promise<void>
  clearDay(date: string): Promise<void>
  /** Try to sync, then wipe this device. Returns unsynced entries if sign-out was refused. */
  signOutSafely(force?: boolean): Promise<{ signedOut: boolean; unsynced: number }>
}

const DataContext = createContext<DataContextValue | null>(null)

const EMPTY_RECORD: PatientRecord = {
  profile: { id: 'none', displayName: '', diagnosisStatus: 'undiagnosed', enabledDomains: [] },
  days: [],
  treatments: [],
  clinicalEvents: [],
  trackedSymptomIds: [],
}

/**
 * The window a real account is analysed over: the last `days` days, but never
 * reaching back before the first entry. A patient who joined ten days ago and
 * logged all ten has full coverage — not 10/92 — and the evidence gate then
 * withholds findings for the honest reason (not enough cycles yet).
 */
export function accountWindow(record: PatientRecord, today: string, days: number): AnalysisWindow {
  const first = record.days[0]?.date ?? today
  const earliest = addDays(today, -(days - 1))
  const start = first > earliest ? first : earliest
  return { start: start > today ? today : start, end: today }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  const demoPersonaId = useApp((s) => s.demoPersonaId)
  const demoEdits = useApp((s) => s.demoEdits)
  const demoRevision = useApp((s) => s.demoRevision)
  const saveDemoDay = useApp((s) => s.saveDemoDay)
  const clearDemoDay = useApp((s) => s.clearDemoDay)
  const windowDays = useApp((s) => s.windowDays)

  const [repo, setRepo] = useState<Repository | null>(null)
  const [accountRecord, setAccountRecord] = useState<PatientRecord | null>(null)
  const [profileRow, setProfileRow] = useState<ProfileRow | null>(null)
  const [profileKnown, setProfileKnown] = useState(false)
  const [accountLabels, setAccountLabels] = useState<Record<string, string>>({})
  const [accountRevision, setAccountRevision] = useState(0)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [today, setToday] = useState(localToday())
  const repoRef = useRef<Repository | null>(null)

  // The date can change while the app is open (overnight, or across a time zone).
  useEffect(() => {
    const tick = () => setToday(localToday())
    const id = setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  // ---- Open the on-device store when an account signs in -------------------
  useEffect(() => {
    if (!user || !supabase) {
      setRepo(null)
      setAccountRecord(null)
      setProfileRow(null)
      setProfileKnown(false)
      return
    }

    const r = new Repository(
      openLocal(user.id),
      supabaseRemote(supabase),
      user.id,
      // No fallback name: the email address must never leak into a report a
      // clinician reads. The report shows a name only if the patient sets one.
      '',
    )
    repoRef.current = r
    let cancelled = false

    const reload = async () => {
      const [record, labels, profile, known] = await Promise.all([
        r.loadRecord(),
        r.getCustomLabels(),
        r.getProfileRow(),
        r.hasLocalProfile(),
      ])
      if (cancelled) return
      setAccountRecord(record)
      setAccountLabels(labels)
      setProfileRow(profile)
      setProfileKnown(known)
      setSyncStatus({ ...r.getSyncStatus() })
      setAccountRevision((n) => n + 1)
    }

    const unsubscribe = r.subscribe(() => void reload())
    setRepo(r)
    void reload().then(() => r.sync())

    const onOnline = () => void r.sync()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void r.sync()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      unsubscribe()
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      r.dispose()
      repoRef.current = null
    }
  }, [user])

  // Keep phone reminders in line with the preference and the record. Period-mode
  // reminders depend on what was logged, so this re-runs as entries change.
  const reminderPref = profileRow?.reminder
  const reminderTime = profileRow?.reminder_time
  useEffect(() => {
    if (!user || !accountRecord || !reminderPref) return
    void syncReminders(reminderPref, accountRecord.days, today, reminderTime).catch(() => {})
  }, [user, accountRecord, reminderPref, reminderTime, today])

  const signOutSafely = useCallback(
    async (force = false) => {
      const r = repoRef.current
      if (r) {
        await r.sync()
        const unsynced = await r.pendingCount()
        if (unsynced > 0 && !force) return { signedOut: false, unsynced }
        const uid = r.userId
        r.dispose()
        await destroyLocal(uid)
      }
      await signOut()
      return { signedOut: true, unsynced: 0 }
    },
    [signOut],
  )

  // ---- Assemble the context value ----------------------------------------
  const value = useMemo<DataContextValue>(() => {
    if (user && supabase) {
      const record = accountRecord ?? EMPTY_RECORD
      return {
        mode: 'account',
        ready: accountRecord !== null,
        record,
        profileRow: profileRow ?? (user ? defaultProfileRow(user.id) : null),
        profileKnown,
        customLabels: accountLabels,
        today,
        window: accountWindow(record, today, windowDays),
        revision: accountRevision,
        repo,
        syncStatus,
        saveDay: (day) => repo?.saveDay(day) ?? Promise.resolve(),
        clearDay: (date) => repo?.clearDay(date) ?? Promise.resolve(),
        signOutSafely,
      }
    }

    if (demoPersonaId) {
      const record = buildDemoRecord(demoPersonaId, demoEdits[demoPersonaId])
      const win = defaultWindow(record, windowDays)
      return {
        mode: 'demo',
        ready: true,
        record,
        profileRow: null,
        profileKnown: true,
        customLabels: CUSTOM_LABELS[demoPersonaId] ?? {},
        // The demo's data ends on a fixed date; treat that as "today" so the
        // ring and check-in show a populated cycle rather than a month of gap.
        today: record.days[record.days.length - 1]?.date ?? today,
        window: win,
        revision: demoRevision,
        repo: null,
        syncStatus: null,
        saveDay: async (day) => saveDemoDay(day),
        clearDay: async (date) => clearDemoDay(date),
        signOutSafely,
      }
    }

    return {
      mode: 'none',
      ready: true,
      record: EMPTY_RECORD,
      profileRow: null,
      profileKnown: true,
      customLabels: {},
      today,
      window: { start: today, end: today },
      revision: 0,
      repo: null,
      syncStatus: null,
      saveDay: async () => {},
      clearDay: async () => {},
      signOutSafely,
    }
  }, [
    user, accountRecord, profileRow, profileKnown, accountLabels, accountRevision, repo, syncStatus,
    demoPersonaId, demoEdits, demoRevision, saveDemoDay, clearDemoDay,
    today, windowDays, signOutSafely,
  ])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used inside <DataProvider>')
  return ctx
}

export function useRecord(): PatientRecord {
  return useData().record
}

export function useCustomLabels(): Record<string, string> {
  return useData().customLabels
}

/** The engine's output for the current record and window. Recomputed only when either changes. */
export function useAnalysis(): Analysis {
  const { mode, record, window, customLabels, revision, repo } = useData()
  const owner = mode === 'account' ? repo?.userId : record.profile.id
  return analyse(record, window, customLabels, `${mode}:${owner}:${window.start}:${window.end}:${revision}`)
}

/** Days between the window's start and end, inclusive — used for "N days tracked". */
export function windowLength(w: AnalysisWindow): number {
  return daysBetween(w.start, w.end) + 1
}
