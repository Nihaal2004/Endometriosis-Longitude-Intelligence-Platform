/**
 * Lock.tsx — The passphrase gate.
 *
 * Everything MedTrace stores is encrypted at rest (see crypto.ts, docs/PRIVACY.md) with
 * a key derived from a passphrase that exists only in memory, never written to disk.
 * This screen is where that passphrase is set (first run) or checked (every run after)
 * before the rest of the app — and the zustand store's persisted state — is allowed to
 * mount at all.
 *
 * Validation deliberately decrypts the stored blob directly here, rather than calling
 * the store's own hydration first and hoping it works: a wrong passphrase must produce
 * a clear "that's wrong" error, not a silent fall-back to empty state that looks like
 * data loss.
 */

import { useState } from 'react'
import { decryptText } from './crypto'
import { hasStoredData, setActivePassphrase, useApp, wipeAllStoredData } from './store'

const STORAGE_KEY = 'medtrace-prototype'

export default function Lock({ onUnlocked }: { onUnlocked: () => void }) {
  const existing = hasStoredData()
  const [mode] = useState<'create' | 'unlock'>(existing ? 'unlock' : 'create')
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (mode === 'create') {
      if (passphrase.length < 6) {
        setError('Use at least 6 characters — this is the only thing protecting your data.')
        return
      }
      if (passphrase !== confirm) {
        setError("Those don't match.")
        return
      }
      setActivePassphrase(passphrase)
      onUnlocked()
      return
    }

    setBusy(true)
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        // Nothing to unlock after all — treat as a fresh start.
        setActivePassphrase(passphrase)
        onUnlocked()
        return
      }
      const decrypted = await decryptText(raw, passphrase)
      const parsed = JSON.parse(decrypted)
      setActivePassphrase(passphrase)
      // Apply the already-decrypted, already-validated state directly, rather than
      // re-decrypting through the store's own hydration path a second time.
      useApp.setState(parsed.state)
      onUnlocked()
    } catch {
      setError('Incorrect passcode.')
    } finally {
      setBusy(false)
    }
  }

  function resetDevice() {
    wipeAllStoredData()
    setActivePassphrase(null)
    window.location.reload()
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5" style={{ background: 'var(--ground)' }}>
      <div className="card w-full max-w-md p-6 sm:p-7">
        <div className="mb-1 flex items-center gap-2.5">
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--bleed)' }} />
          <span className="display" style={{ fontSize: 20, fontWeight: 600 }}>MedTrace</span>
        </div>

        <h1 className="mt-4" style={{ fontSize: 20 }}>
          {mode === 'create' ? 'Protect this device' : 'Enter your passcode'}
        </h1>

        <p className="mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {mode === 'create'
            ? 'Everything you enter is encrypted (AES-256, derived from this passcode) before it ever touches this device\'s storage. Nothing is sent anywhere — there is no server. If you forget this passcode, the data cannot be recovered; there is no reset email, because there is nowhere for one to come from.'
            : 'Your data on this device is encrypted. Enter your passcode to decrypt it for this session.'}
        </p>

        <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
          <input
            type="password"
            autoFocus
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder={mode === 'create' ? 'Choose a passcode (6+ characters)' : 'Passcode'}
            className="focus-ring w-full rounded-xl px-3.5 py-3 text-[14px]"
            style={{ border: '1px solid var(--hairline-strong)', background: 'var(--surface)', color: 'var(--ink)' }}
          />
          {mode === 'create' && (
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm passcode"
              className="focus-ring w-full rounded-xl px-3.5 py-3 text-[14px]"
              style={{ border: '1px solid var(--hairline-strong)', background: 'var(--surface)', color: 'var(--ink)' }}
            />
          )}

          {error && (
            <p className="text-[12.5px]" style={{ color: 'var(--rose, #b4413a)' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !passphrase}
            className="focus-ring mt-1 rounded-full px-6 py-3 text-[15px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--ink)', color: 'var(--ground)', border: 'none' }}
          >
            {busy ? 'Checking…' : mode === 'create' ? 'Set passcode and continue' : 'Unlock'}
          </button>
        </form>

        {mode === 'unlock' && (
          <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--hairline)' }}>
            {!confirmingReset ? (
              <button
                onClick={() => setConfirmingReset(true)}
                className="focus-ring text-[12.5px] underline"
                style={{ color: 'var(--ink-muted)' }}
              >
                Forgot your passcode?
              </button>
            ) : (
              <div className="rounded-xl p-3" style={{ background: 'var(--surface-sunken)' }}>
                <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                  There is no recovery — resetting permanently deletes everything stored on this
                  device and starts over.
                </p>
                <div className="mt-2.5 flex gap-2">
                  <button
                    onClick={resetDevice}
                    className="focus-ring rounded-full px-4 py-2 text-[12.5px] font-medium"
                    style={{ background: 'var(--ink)', color: 'var(--ground)', border: 'none' }}
                  >
                    Delete everything and start over
                  </button>
                  <button
                    onClick={() => setConfirmingReset(false)}
                    className="focus-ring rounded-full px-4 py-2 text-[12.5px]"
                    style={{ border: '1px solid var(--hairline-strong)', background: 'transparent', color: 'var(--ink-secondary)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
