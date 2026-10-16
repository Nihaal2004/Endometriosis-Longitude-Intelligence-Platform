/**
 * summaryStore.ts — the AI-written summary for the report currently on screen.
 *
 * Kept in memory only, never on disk: it is a reading aid generated on request.
 * It is tied to the exact wording of the claims it rewrote, so once new logs
 * change the report, the old summary is no longer shown.
 */

import { create } from 'zustand'
import type { Claim } from '../engine/types'

export const claimsKey = (claims: Claim[]) => claims.map((c) => `${c.id}\u0000${c.text}`).join('\u0001')

interface SummaryState {
  key: string | null
  rewrites: Record<string, string>
  set: (key: string, rewrites: Record<string, string>) => void
  clear: () => void
}

export const useSummaryStore = create<SummaryState>()((set) => ({
  key: null,
  rewrites: {},
  set: (key, rewrites) => set({ key, rewrites }),
  clear: () => set({ key: null, rewrites: {} }),
}))

/** Checked rewrites for these claims, or null if none were made for this exact report. */
export function useCurrentSummary(claims: Claim[]): Record<string, string> | null {
  const { key, rewrites } = useSummaryStore()
  return key !== null && key === claimsKey(claims) ? rewrites : null
}
