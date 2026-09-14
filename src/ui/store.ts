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
import { persist } from 'zustand/middleware'
import { CUSTOM_LABELS, PERSONAS, getPersona } from '../data/personas'
import { buildFeatureContext, defaultWindow, type FeatureContext } from '../engine/features'
import { runPatternEngine, type PatternResult } from '../engine/patterns'
import { generateBrief, DEFAULT_BRIEF_CONFIG } from '../engine/brief'
import { applyFidelityGate, verifyBrief, type FidelityReport } from '../engine/fidelity'
import type { Claim, ConsultationBrief, DayRecord, PatientRecord } from '../engine/types'

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
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      personaId: PERSONAS[0].id,
      sessionEdits: {},
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
    }),
    {
      name: 'medtrace-prototype',
      // Derived analysis is never persisted; it is recomputed from the record.
      partialize: (s) => ({
        personaId: s.personaId,
        sessionEdits: s.sessionEdits,
        theme: s.theme,
        windowDays: s.windowDays,
      }),
    },
  ),
)

// ---------------------------------------------------------------------------
// Record assembly
// ---------------------------------------------------------------------------

/** The persona's generated record with this session's edits layered on top. */
export function buildRecord(personaId: string, edits: Record<string, DayRecord>): PatientRecord {
  const base = getPersona(personaId).record
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
): Analysis {
  const key = `${personaId}:${windowDays}:${revision}`
  if (cache && cache.key === key) return cache.value

  const record = buildRecord(personaId, edits)
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
  return analyse(personaId, sessionEdits[personaId] ?? {}, windowDays, revision)
}

export function useRecord(): PatientRecord {
  const personaId = useApp((s) => s.personaId)
  const sessionEdits = useApp((s) => s.sessionEdits)
  const revision = useApp((s) => s.revision)
  // revision participates so the record identity changes after an edit.
  void revision
  return buildRecord(personaId, sessionEdits[personaId] ?? {})
}

export function useCustomLabels(): Record<string, string> {
  const personaId = useApp((s) => s.personaId)
  return CUSTOM_LABELS[personaId] ?? {}
}
