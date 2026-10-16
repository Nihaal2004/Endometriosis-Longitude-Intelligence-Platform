/**
 * PrivacyDialog — the privacy notice as a pop-up, so reading it never takes the
 * patient away from the form they are filling in.
 */

import { useEffect, useRef } from 'react'
import { NOTICE_VERSION, PRIVACY_SECTIONS } from './privacy'

export function PrivacyNoticeText() {
  return (
    <>
      <p className="text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
        Version {NOTICE_VERSION}
      </p>
      {PRIVACY_SECTIONS.map((s) => (
        <section key={s.heading} className="mt-6">
          <h3 style={{ fontSize: 17 }}>{s.heading}</h3>
          {s.body.map((p) => (
            <p key={p} className="mt-1.5 text-[14.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {p}
            </p>
          ))}
        </section>
      ))}
    </>
  )
}

export function PrivacyDialog({
  open,
  onClose,
  onAgree,
}: {
  open: boolean
  onClose: () => void
  /** When given, the dialog ends with an "I agree" button that closes it too. */
  onAgree?: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      style={{ background: 'rgba(20, 14, 20, 0.45)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-dialog-title"
    >
      <div
        className="flex max-h-[88vh] w-full max-w-xl flex-col rounded-t-2xl sm:rounded-2xl"
        style={{ background: 'var(--surface)', border: '1px solid var(--hairline)', paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5"
          style={{ borderBottom: '1px solid var(--hairline)' }}>
          <h2 id="privacy-dialog-title" style={{ fontSize: 21 }}>Privacy notice</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close privacy notice"
            className="focus-ring rounded-full px-3 py-1 text-[13px]"
            style={{ border: '1px solid var(--hairline-strong)', background: 'transparent', color: 'var(--ink)' }}>
            Close
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-5 pt-4">
          <PrivacyNoticeText />
        </div>

        {onAgree && (
          <div className="px-5 py-4" style={{ borderTop: '1px solid var(--hairline)' }}>
            <button type="button" className="btn btn-primary focus-ring w-full" onClick={onAgree}>
              I have read and agree
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
