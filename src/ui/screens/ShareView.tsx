/**
 * ShareView — /s/:token, the page a clinician opens. No account needed.
 *
 * It can show exactly one thing: the snapshot the patient approved. The link
 * alone opens nothing: the clinician enters the 6-digit access code the patient
 * gave them separately, and view_shared_report() checks both server-side. A
 * wrong code, a revoked, expired or locked link, and one that never existed are
 * indistinguishable by design; five wrong codes lock the link.
 */

import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../data/supabase'
import { SharedReportView } from '../share/SharedReportView'
import type { SharedReport } from '../share/snapshot'
import { Wordmark } from './auth/AuthLayout'

type State =
  | { kind: 'code'; failed: boolean }
  | { kind: 'loading' }
  | { kind: 'ok'; report: SharedReport; expiresAt: string }
  | { kind: 'offline' }

async function fetchReport(token: string, code: string): Promise<State> {
  if (!supabase) return { kind: 'code', failed: true }
  const { data, error } = await supabase.rpc('view_shared_report', { p_token: token, p_code: code })
  if (error) return { kind: 'offline' }
  if (!data) return { kind: 'code', failed: true }
  return { kind: 'ok', report: data.snapshot as SharedReport, expiresAt: data.expires_at as string }
}

export default function ShareView() {
  const { token = '' } = useParams()
  const [state, setState] = useState<State>({ kind: 'code', failed: false })
  const [code, setCode] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (code.length !== 6) return
    setState({ kind: 'loading' })
    const next = await fetchReport(token, code)
    if (next.kind === 'code') setCode('')
    setState(next)
  }

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

      {(state.kind === 'code' || state.kind === 'loading') && (
        <form className="card mx-auto max-w-md p-6" onSubmit={(e) => void submit(e)}>
          <h1 style={{ fontSize: 22 }}>Enter the access code</h1>
          <p className="mt-2 text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
            The patient will have given you a 6-digit code separately from this link.
          </p>
          <input className="input mt-4 text-center font-mono text-[22px] tracking-[0.3em]" inputMode="numeric"
            autoComplete="one-time-code" maxLength={6} aria-label="Access code" value={code} autoFocus
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          {state.kind === 'code' && state.failed && (
            <p className="notice notice-error mt-3">
              That didn’t work. Check the code and try again. The link may also have expired, been withdrawn, or been
              locked after too many wrong codes; if so, ask the patient for a new one.
            </p>
          )}
          <button type="submit" className="btn btn-primary focus-ring mt-4 w-full" style={{ minHeight: 42 }}
            disabled={code.length !== 6 || state.kind === 'loading'}>
            {state.kind === 'loading' ? 'Opening…' : 'Open report'}
          </button>
        </form>
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
