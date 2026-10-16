/**
 * SharePanel — choose sections and privacy, preview the exact document, create a link.
 *
 * The server stores only hashes of the token and access code. The patient's copy
 * of both is kept on this device (repo.saveShareKey), so she can reopen a live
 * link from the list; on another device, or after signing out, she revokes it
 * and creates a new one.
 * The link and the code are meant to travel separately: a forwarded link alone
 * opens nothing, and five wrong codes lock it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDateLong, mainConcerns } from '../../engine/brief'
import { supabase } from '../../data/supabase'
import { useAnalysis, useData } from '../data'
import { useCurrentSummary } from '../summaryStore'
import { hasFertilityAnswers } from './background'
import { buildShareSnapshot, DEFAULT_PRIVACY, SHARE_SECTIONS, type SharePrivacy, type ShareSectionId } from './snapshot'
import { SharedReportView } from './SharedReportView'

interface GrantRow {
  id: string
  created_at: string
  expires_at: string
  revoked_at: string | null
  view_count: number
  last_viewed: string | null
  sections: string[]
}

/** The public web address a clinician opens. Native builds must set VITE_PUBLIC_APP_URL. */
export function shareUrl(token: string): string {
  const configured = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined
  const base = configured?.replace(/\/+$/, '') || `${window.location.origin}${window.location.pathname}`.replace(/\/+$/, '')
  return `${base}/#/s/${token}`
}

export function SharePanel() {
  const { record, reportLabels, repo } = useData()
  const { ctx, verifiedClaims } = useAnalysis()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<ShareSectionId>>(
    () => new Set(SHARE_SECTIONS.filter((s) => s.defaultOn).map((s) => s.id)),
  )
  const [privacy, setPrivacy] = useState<SharePrivacy>(DEFAULT_PRIVACY)
  const [days, setDays] = useState<1 | 7 | 30>(7)
  const [preview, setPreview] = useState(false)
  const [created, setCreated] = useState<{ url: string; code: string; expires: string } | null>(null)
  const [keys, setKeys] = useState<Record<string, { url: string; code: string }>>({})
  const [grants, setGrants] = useState<GrantRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const hasSexualContent = record.profile.enabledDomains.includes('sexual')
  const summary = useCurrentSummary(verifiedClaims)

  const snapshot = useMemo(
    () =>
      buildShareSnapshot({
        claims: verifiedClaims,
        record,
        window: {
          start: ctx.window.start,
          end: ctx.window.end,
          loggedDays: ctx.loggedDays,
          calendarDays: ctx.calendarDays,
          completeCycles: ctx.windowCycles.filter((c) => c.complete).length,
        },
        concerns: mainConcerns(ctx, 4, reportLabels),
        selected,
        privacy,
        summary: summary ?? undefined,
      }),
    [verifiedClaims, record, ctx, reportLabels, selected, privacy, summary],
  )

  const loadGrants = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase
      .from('share_grants')
      .select('id, created_at, expires_at, revoked_at, view_count, last_viewed, sections')
      .order('created_at', { ascending: false })
      .limit(20)
    setGrants((data as GrantRow[]) ?? [])
    if (repo) setKeys(await repo.getShareKeys())
  }, [repo])

  useEffect(() => {
    void loadGrants()
  }, [loadGrants])

  async function create() {
    if (!supabase) return
    setBusy(true)
    setError(null)
    const { data, error: e } = await supabase.rpc('create_share_link', {
      p_snapshot: snapshot,
      p_sections: [...selected],
      p_days: days,
    })
    setBusy(false)
    const row = Array.isArray(data) ? data[0] : data
    if (e || !row?.token || !row?.code) {
      setError('Couldn’t create the link. Share links need an internet connection. Check yours and try again.')
      return
    }
    const key = { url: shareUrl(row.token as string), code: row.code as string }
    await repo?.saveShareKey(row.id as string, key)
    setCreated({ ...key, expires: row.expires_at as string })
    setPreview(false)
    void loadGrants()
  }

  async function revoke(id: string) {
    if (!supabase) return
    await supabase.from('share_grants').update({ revoked_at: new Date().toISOString() }).eq('id', id)
    await repo?.audit('share_link_revoked', id)
    void loadGrants()
  }

  async function copy() {
    if (!created) return
    await navigator.clipboard.writeText(created.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const now = new Date().toISOString()
  const live = grants.filter((g) => !g.revoked_at && g.expires_at > now)

  return (
    <div className="card p-4">
      <h2 style={{ fontSize: 15 }}>Share with a clinician</h2>
      <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        Creates a private link to a fixed copy of this report, locked with a code only you can give
        out. They see only what you choose, and nothing else in your account.
      </p>

      {created ? (
        <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--sage-soft)' }}>
          <p className="text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>Link ready</p>
          <input readOnly className="input mt-2 text-[12px]" style={{ minHeight: 38 }} value={created.url}
            onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" className="btn btn-primary focus-ring" style={{ minHeight: 38, padding: '0 16px' }}
              onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button type="button" className="link text-[12.5px]" onClick={() => { setCreated(null); setOpen(false) }}>
              Done
            </button>
          </div>
          <p className="mt-3 text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>Access code</p>
          <p className="mt-1 font-mono text-[24px] font-semibold tracking-[0.3em]" style={{ color: 'var(--ink)' }}
            aria-label={`Access code ${created.code.split('').join(' ')}`}>
            {created.code}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            The link doesn’t open without this code. Give it to your doctor separately: tell them in person or
            on the phone, or send it in a different message from the link. Five wrong tries lock the link.
          </p>
          <p className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-secondary)' }}>
            Expires {formatDateLong(created.expires.slice(0, 10))}. Saved on this phone only: open it again from
            Active links below, or revoke it there at any time.
          </p>
        </div>
      ) : !open ? (
        <button type="button" className="btn btn-primary focus-ring mt-3 w-full" style={{ minHeight: 42 }}
          onClick={() => setOpen(true)}>
          Create a share link
        </button>
      ) : (
        <div className="mt-3">
          <p className="text-[12.5px] font-semibold">Include</p>
          <div className="mt-1.5 space-y-1.5">
            {SHARE_SECTIONS.filter((s) => (s.id !== 'sexual_health' || hasSexualContent) && (s.id !== 'summary' || summary)).map((s) => (
              <label key={s.id} className="flex items-start gap-2.5 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" style={{ accentColor: 'var(--ink)' }}
                  checked={selected.has(s.id)}
                  onChange={(e) => setSelected((cur) => {
                    const next = new Set(cur)
                    if (e.target.checked) next.add(s.id)
                    else next.delete(s.id)
                    return next
                  })} />
                <span>
                  {s.title}
                  {s.note && <span className="block text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>{s.note}</span>}
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
            The recorded period and data-quality note are always included so the rest can be read fairly.
            Private notes are never shared.
          </p>

          <p className="mt-3 text-[12.5px] font-semibold">About you</p>
          <div className="mt-1.5 space-y-1.5">
            {([
              { key: 'name', title: 'My name', note: record.profile.displayName ? 'When off, the report says “Name withheld”, so tell your doctor who you are.' : 'You haven’t set a name in Me.' },
              { key: 'diagnosis', title: 'Diagnosis status and earlier diagnoses' },
              { key: 'background', title: 'Medical and menstrual history' },
              ...(hasFertilityAnswers(record.profile)
                ? [{ key: 'fertility', title: 'Fertility and pregnancy', note: 'Off unless you include it for this report.' }] as const
                : []),
            ] as const).map((o) => (
              <label key={o.key} className="flex items-start gap-2.5 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" style={{ accentColor: 'var(--ink)' }}
                  checked={privacy[o.key]}
                  disabled={o.key === 'name' && !record.profile.displayName}
                  onChange={(e) => setPrivacy((cur) => ({ ...cur, [o.key]: e.target.checked }))} />
                <span>
                  {o.title}
                  {'note' in o && <span className="block text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>{o.note}</span>}
                </span>
              </label>
            ))}
          </div>

          <p className="mt-3 text-[12.5px] font-semibold">Link lasts</p>
          <div className="segmented mt-1.5" role="tablist">
            {([1, 7, 30] as const).map((d) => (
              <button key={d} type="button" role="tab" aria-selected={days === d} className="focus-ring"
                onClick={() => setDays(d)}>
                {d === 1 ? '1 day' : `${d} days`}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 40 }}
              onClick={() => setPreview((v) => !v)}>
              {preview ? 'Hide preview' : 'Preview'}
            </button>
            <button type="button" className="btn btn-primary focus-ring" style={{ minHeight: 40 }}
              onClick={() => void create()} disabled={busy}>
              {busy ? 'Creating…' : 'Create link'}
            </button>
          </div>
          {error && <p className="notice notice-error mt-3">{error}</p>}
        </div>
      )}

      {preview && !created && (
        <div className="fixed inset-0 z-50 overflow-y-auto p-4 sm:p-8" style={{ background: 'rgba(20,14,20,0.4)' }}
          onClick={() => setPreview(false)} role="dialog" aria-modal="true" aria-label="Preview of shared report">
          <div className="mx-auto max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between rounded-xl px-4 py-2.5"
              style={{ background: 'var(--surface)' }}>
              <span className="text-[13px] font-semibold">Preview: exactly what the clinician will see</span>
              <button type="button" className="link text-[13px]" onClick={() => setPreview(false)}>Close</button>
            </div>
            <SharedReportView report={snapshot} />
          </div>
        </div>
      )}

      {live.length > 0 && (
        <div className="mt-5">
          <p className="text-[12.5px] font-semibold">Active links</p>
          <ul className="mt-1.5 space-y-1.5">
            {live.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[12px]"
                style={{ background: 'var(--surface-sunken)' }}>
                <span style={{ color: 'var(--ink-secondary)' }}>
                  Created {formatDateLong(g.created_at.slice(0, 10))} · viewed {g.view_count}×
                </span>
                <span className="flex shrink-0 gap-3">
                  {keys[g.id] && (
                    <button type="button" className="link text-[12px]"
                      onClick={() => { setCreated({ ...keys[g.id], expires: g.expires_at }); setOpen(false) }}>
                      Show link &amp; code
                    </button>
                  )}
                  <button type="button" className="link text-[12px]" onClick={() => void revoke(g.id)}>Revoke</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
