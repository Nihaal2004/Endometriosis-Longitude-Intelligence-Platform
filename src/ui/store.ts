/**
 * store.ts — Application state.
 *
 * The engine is pure and synchronous, so state here is deliberately thin: it holds
 * which persona is active, any days the user has logged in this session, and UI
 * preferences. Everything analytical is *derived* by calling the engine, never stored.
 *
 * Analysis is memoised on a cheap signature (persona id + number of logged days +
 * last edit stamp) rather than cached indefinitely, so logging a day on the Today
 * screen genuinely re-runs the engine and the Patterns screen genuinely changes.
 */

import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { CUSTOM_LABELS, PERSONAS, getPersona } from '../data/personas'
import { buildMyRecord, MY_RECORD_ID, type MyProfileInput } from '../data/myRecord'
import { buildFeatureContext, defaultWindow, type FeatureContext } from '../engine/features'
import { runPatternEngine, type PatternResult } from '../engine/patterns'
import { generateBrief, DEFAULT_BRIEF_CONFIG } from '../engine/brief'
import { applyFidelityGate, verifyBrief, type FidelityReport } from '../engine/fidelity'
import { decryptText, encryptText } from './crypto'
import type { Claim, ConsultationBrief, DayRecord, PatientRecord } from '../engine/types'

export { MY_RECORD_ID }

// ---------------------------------------------------------------------------
// Encrypted persistence
//
// The passphrase lives only in this module-level variable — never written to disk,
// never included in the persisted state itself. Nothing is decryptable without it,
// and there is no recovery path if it's lost: see crypto.ts and docs/PRIVACY.md.
// ---------------------------------------------------------------------------

let activePassphrase: string | null = null

export function setActivePassphrase(p: string | null): void {
  activePassphrase = p
}

export function hasActivePassphrase(): boolean {
  return activePassphrase !== null
}

const STORAGE_KEY = 'medtrace-prototype'

const encryptedStorage: StateStorage = {
  getItem: async (name) => {
    const raw = localStorage.getItem(name)
    if (!raw || !activePassphrase) return null
    try {
      return await decryptText(raw, activePassphrase)
    } catch {
      // Wrong passphrase, or nothing decryptable yet — the lock screen is responsible
      // for validating the passphrase before this ever runs, so this path means the
      // caller asked to rehydrate without unlocking first.
      return null
    }
  },
  setItem: async (name, value) => {
    if (!activePassphrase) return // locked — refuse to write plaintext, ever
    const encrypted = await encryptText(value, activePassphrase)
    localStorage.setItem(name, encrypted)
  },
  removeItem: (name) => localStorage.removeItem(name),
}

/** True once *something* has been saved on this device, encrypted or not. */
export function hasStoredData(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null
}

/** Irreversibly wipes all locally stored app state. Used by "delete my data". */
export function wipeAllStoredData(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export type ScreenTheme = 'light' | 'dark' | 'system'

interface Analysis {
  ctx: FeatureContext
  patterns: PatternResult
  brief: ConsultationBrief
  fidelity: FidelityReport
  verifiedClaims: Claim[]
  rejectedClaims: Claim[]
}

interface AppState {
  personaId: string
  /** Days logged during this session, keyed by persona then date. */
  sessionEdits: Record<string, Record<string, DayRecord>>
  /** Baseline profile for the real, non-demo record — every field optional (PRD §5). */
  myProfile: MyProfileInput
  /** Whether the brief onboarding step for "My record" has been shown/skipped. */
  onboarded: boolean
  theme: ScreenTheme
  /** Window length in days used by the analysis screens. */
  windowDays: number
  /** Bumped whenever an edit lands, to invalidate the analysis memo. */
  revision: number

  setPersona: (id: string) => void
  setTheme: (theme: ScreenTheme) => void
  setWindowDays: (days: number) => void
  upsertDay: (day: DayRecord) => void
  resetSessionEdits: () => void
  setMyProfile: (profile: MyProfileInput) => void
  completeOnboarding: () => void
  /** Wipes only the real record — "me" — not the synthetic demo personas. */
  deleteMyRecord: () => void
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      personaId: MY_RECORD_ID,
      sessionEdits: {},
      myProfile: {},
      onboarded: false,
      theme: 'system',
      windowDays: 92,
      revision: 0,

      setPersona: (personaId) => set({ personaId }),
      setTheme: (theme) => set({ theme }),
      setWindowDays: (windowDays) => set((s) => ({ windowDays, revision: s.revision + 1 })),

      upsertDay: (day) =>
        set((state) => {
          const forPersona = { ...(state.sessionEdits[state.personaId] ?? {}) }
          forPersona[day.date] = day
          return {
            sessionEdits: { ...state.sessionEdits, [state.personaId]: forPersona },
            revision: state.revision + 1,
          }
        }),

      resetSessionEdits: () =>
        set((state) => ({
          sessionEdits: { ...state.sessionEdits, [state.personaId]: {} },
          revision: state.revision + 1,
        })),

      setMyProfile: (profile) =>
        set((s) => ({ myProfile: { ...s.myProfile, ...profile }, revision: s.revision + 1 })),

      completeOnboarding: () => set({ onboarded: true }),

      deleteMyRecord: () =>
        set((state) => {
          const sessionEdits = { ...state.sessionEdits }
          delete sessionEdits[MY_RECORD_ID]
          return { sessionEdits, myProfile: {}, onboarded: false, revision: state.revision + 1 }
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => encryptedStorage),
      // Derived analysis is never persisted; it is recomputed from the record.
      partialize: (s) => ({
        personaId: s.personaId,
        sessionEdits: s.sessionEdits,
        myProfile: s.myProfile,
        onboarded: s.onboarded,
        theme: s.theme,
        windowDays: s.windowDays,
      }),
      // Hydration is driven manually from the lock screen, once a passphrase has been
      // validated — see Lock.tsx. Auto-hydrating on module load would run before any
      // passphrase exists to decrypt with.
      skipHydration: true,
    },
  ),
)

// ---------------------------------------------------------------------------
// Record assembly
// ---------------------------------------------------------------------------

/**
 * The active record with this session's edits layered on top: either a demo persona's
 * generated record, or the real "My record" built from whatever baseline profile the
 * user gave (all optional) plus nothing else — it only grows from here through Today.
 */
export function buildRecord(
  personaId: string,
  edits: Record<string, DayRecord>,
  myProfile: MyProfileInput = {},
): PatientRecord {
  const base = personaId === MY_RECORD_ID ? buildMyRecord(myProfile) : getPersona(personaId).record
  if (!edits || Object.keys(edits).length === 0) return base

  const byDate = new Map(base.days.map((d) => [d.date, d]))
  for (const [date, day] of Object.entries(edits)) byDate.set(date, day)

  return {
    ...base,
    days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  }
}

// ---------------------------------------------------------------------------
// Memoised analysis
// ---------------------------------------------------------------------------

let cache: { key: string; value: Analysis } | null = null

export function analyse(
  personaId: string,
  edits: Record<string, DayRecord>,
  windowDays: number,
  revision: number,
  myProfile: MyProfileInput = {},
): Analysis {
  const key = `${personaId}:${windowDays}:${revision}`
  if (cache && cache.key === key) return cache.value

  const record = buildRecord(personaId, edits, myProfile)
  const window = defaultWindow(record, windowDays)
  const ctx = buildFeatureContext(record, window)
  const patterns = runPatternEngine(ctx)

  const brief = generateBrief(ctx, patterns.findings, patterns.suppressed, {
    ...DEFAULT_BRIEF_CONFIG,
    customLabels: CUSTOM_LABELS[personaId],
  })

  // Every claim is independently re-derived before it is allowed on screen.
  const fidelity = verifyBrief(brief.claims, record, brief.windowStart, brief.windowEnd)
  const { kept, rejected } = applyFidelityGate(brief.claims, fidelity)

  const value: Analysis = {
    ctx,
    patterns,
    brief,
    fidelity,
    verifiedClaims: kept,
    rejectedClaims: rejected,
  }
  cache = { key, value }
  return value
}

/** Hook form — re-runs whenever the persona, window or revision changes. */
export function useAnalysis(): Analysis {
  const personaId = useApp((s) => s.personaId)
  const sessionEdits = useApp((s) => s.sessionEdits)
  const windowDays = useApp((s) => s.windowDays)
  const revision = useApp((s) => s.revision)
  const myProfile = useApp((s) => s.myProfile)
  return analyse(personaId, sessionEdits[personaId] ?? {}, windowDays, revision, myProfile)
}

export function useRecord(): PatientRecord {
  const personaId = useApp((s) => s.personaId)
  const sessionEdits = useApp((s) => s.sessionEdits)
  const revision = useApp((s) => s.revision)
  const myProfile = useApp((s) => s.myProfile)
  // revision participates so the record identity changes after an edit.
  void revision
  return buildRecord(personaId, sessionEdits[personaId] ?? {}, myProfile)
}

export function useCustomLabels(): Record<string, string> {
  const personaId = useApp((s) => s.personaId)
  return CUSTOM_LABELS[personaId] ?? {}
}
