/**
 * store.ts — UI preferences and the demo.
 *
 * Real patient data does NOT live here. It lives in the on-device database behind
 * src/data/repository.ts and reaches screens through DataProvider. This store
 * holds only what is safe to keep in plain localStorage: theme, window length,
 * quick or detailed logging,
 * which demo persona is open, and edits made while exploring the demo.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getPersona } from '../data/personas'
import { generateBrief, DEFAULT_BRIEF_CONFIG } from '../engine/brief'
import { buildFeatureContext, type AnalysisWindow, type FeatureContext } from '../engine/features'
import { applyFidelityGate, verifyBrief, type FidelityReport } from '../engine/fidelity'
import { runPatternEngine, type PatternResult } from '../engine/patterns'
import type { Claim, ConsultationBrief, DayRecord, PatientRecord } from '../engine/types'

export type ScreenTheme = 'light' | 'dark' | 'system'
export type LogMode = 'quick' | 'detailed'

interface AppState {
  /** Non-null while exploring a demo patient without an account. */
  demoPersonaId: string | null
  /** In-browser edits made while exploring the demo. Never sent anywhere. */
  demoEdits: Record<string, Record<string, DayRecord | null>>
  demoRevision: number
  theme: ScreenTheme
  windowDays: number
  /** Quick asks bleeding, pain, symptoms and a note; detailed adds severity, impact and medication. */
  logMode: LogMode

  enterDemo: (personaId: string) => void
  exitDemo: () => void
  setDemoPersona: (personaId: string) => void
  saveDemoDay: (day: DayRecord) => void
  clearDemoDay: (date: string) => void
  setTheme: (theme: ScreenTheme) => void
  setLogMode: (logMode: LogMode) => void
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      demoPersonaId: null,
      demoEdits: {},
      demoRevision: 0,
      theme: 'system',
      windowDays: 92,
      logMode: 'quick',

      enterDemo: (demoPersonaId) => set({ demoPersonaId }),
      exitDemo: () => set({ demoPersonaId: null }),
      setDemoPersona: (demoPersonaId) => set({ demoPersonaId }),

      saveDemoDay: (day) =>
        set((s) => {
          if (!s.demoPersonaId) return s
          const forPersona = { ...(s.demoEdits[s.demoPersonaId] ?? {}), [day.date]: day }
          return {
            demoEdits: { ...s.demoEdits, [s.demoPersonaId]: forPersona },
            demoRevision: s.demoRevision + 1,
          }
        }),

      clearDemoDay: (date) =>
        set((s) => {
          if (!s.demoPersonaId) return s
          // null marks a cleared day, distinct from "no edit".
          const forPersona = { ...(s.demoEdits[s.demoPersonaId] ?? {}), [date]: null }
          return {
            demoEdits: { ...s.demoEdits, [s.demoPersonaId]: forPersona },
            demoRevision: s.demoRevision + 1,
          }
        }),

      setTheme: (theme) => set({ theme }),
      setLogMode: (logMode) => set({ logMode }),
    }),
    {
      name: 'medtrace-ui',
      partialize: (s) => ({
        demoPersonaId: s.demoPersonaId,
        demoEdits: s.demoEdits,
        theme: s.theme,
        windowDays: s.windowDays,
        logMode: s.logMode,
      }),
    },
  ),
)

/** A demo persona's record with any in-browser edits applied. */
export function buildDemoRecord(
  personaId: string,
  edits: Record<string, DayRecord | null> | undefined,
): PatientRecord {
  const base = getPersona(personaId).record
  if (!edits || Object.keys(edits).length === 0) return base
  const byDate = new Map(base.days.map((d) => [d.date, d]))
  for (const [date, day] of Object.entries(edits)) {
    if (day === null) byDate.delete(date)
    else byDate.set(date, day)
  }
  return { ...base, days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) }
}

// ---------------------------------------------------------------------------
// Analysis — the engine, memoised on a cheap key
// ---------------------------------------------------------------------------

export interface Analysis {
  ctx: FeatureContext
  patterns: PatternResult
  brief: ConsultationBrief
  fidelity: FidelityReport
  verifiedClaims: Claim[]
  rejectedClaims: Claim[]
}

let cache: { key: string; value: Analysis } | null = null

export function analyse(
  record: PatientRecord,
  window: AnalysisWindow,
  customLabels: Record<string, string>,
  key: string,
): Analysis {
  if (cache && cache.key === key) return cache.value

  const ctx = buildFeatureContext(record, window)
  const patterns = runPatternEngine(ctx)
  const brief = generateBrief(ctx, patterns.findings, patterns.suppressed, {
    ...DEFAULT_BRIEF_CONFIG,
    customLabels,
  })

  // Every claim is independently re-derived before it may be shown.
  const fidelity = verifyBrief(brief.claims, record, brief.windowStart, brief.windowEnd)
  const { kept, rejected } = applyFidelityGate(brief.claims, fidelity)

  const value: Analysis = { ctx, patterns, brief, fidelity, verifiedClaims: kept, rejectedClaims: rejected }
  cache = { key, value }
  return value
}
