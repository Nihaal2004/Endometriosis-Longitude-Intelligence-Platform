/**
 * ShareView — /s/:token, the page a clinician opens. No account needed.
 *
 * It can show exactly one thing: the snapshot the patient approved. The token is
 * checked server-side by view_shared_report(), which cannot reach any other data.
 * Revoked, expired and never-existed links are indistinguishable by design.
 */

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../data/supabase'
import { SharedReportView } from '../share/SharedReportView'
import type { SharedReport } from '../share/snapshot'
import { Wordmark } from './auth/AuthLayout'

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; report: SharedReport; expiresAt: string }
  | { kind: 'gone' }
  | { kind: 'offline' }

/**
 * Each fetch counts as a view and is written to the patient's audit log, so two
 * concurrent fetches of one page load (React StrictMode runs effects twice in
 * development) would inflate the "viewed N times" the patient sees. Concurrent
 * requests for the same token share one call.
 */
const inflight = new Map<string, Promise<State>>()

function fetchReport(token: string): Promise<State> {
  const existing = inflight.get(token)
  if (existing) return existing
  const request = (async (): Promise<State> => {
    if (!supabase) return { kind: 'gone' }
    const { data, error } = await supabase.rpc('view_shared_report', { p_token: token })
    if (error) return { kind: 'offline' }
    if (!data) return { kind: 'gone' }
    return { kind: 'ok', report: data.snapshot as SharedReport, expiresAt: data.expires_at as string }
  })()
  inflight.set(token, request)
  void request.finally(() => setTimeout(() => inflight.delete(token), 1000))
  return request
}

export default function ShareView() {
  const { token = '' } = useParams()
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let active = true
    void fetchReport(token).then((next) => {
      if (active) setState(next)
    })
    return () => {
      active = false
    }
  }, [token])

  return (
    <div className="safe-top mx-auto w-full max-w-3xl px-5 pb-16 pt-8 print-full">
      <div className="no-print mb-6 flex items-center justify-between">
        <Wordmark size={20} />
        {state.kind === 'ok' && (
          <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 38 }} onClick={() => window.print()}>
            Print / PDF
          </button>
        )}
      </div>

      {state.kind === 'loading' && (
        <p className="text-center text-[14px]" style={{ color: 'var(--ink-muted)' }}>Loading report…</p>
      )}
      {state.kind === 'gone' && (
        <div className="card p-6 text-center">
          <h1 style={{ fontSize: 22 }}>This report is no longer available</h1>
          <p className="mt-2 text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
            The link may have expired or been withdrawn by the patient. Ask them to share a new one.
          </p>
        </div>
      )}
      {state.kind === 'offline' && (
        <div className="card p-6 text-center">
          <h1 style={{ fontSize: 22 }}>Couldn’t load the report</h1>
          <p className="mt-2 text-[14px]" style={{ color: 'var(--ink-secondary)' }}>Check your connection and refresh the page.</p>
        </div>
      )}
      {state.kind === 'ok' && <SharedReportView report={state.report} expiresAt={state.expiresAt} />}
    </div>
  )
}
