/**
 * AppLock — fingerprint, face or device PIN before the app opens.
 *
 * Off by default, a per-device setting (Me → Lock the app). When on, the app is
 * covered on launch and whenever it returns after a minute in the background —
 * long enough not to nag during a quick switch to another app, short enough that
 * a phone left on a table is covered.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { App } from '@capacitor/app'
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import { isNative } from './platform'

const LOCK_KEY = 'medtrace.app-lock'
const RELOCK_AFTER_MS = 60_000

export async function isAppLockEnabled(): Promise<boolean> {
  if (!isNative) return false
  return (await SecureStorage.getItem(LOCK_KEY)) === 'on'
}

export async function canUseAppLock(): Promise<boolean> {
  if (!isNative) return false
  const info = await BiometricAuth.checkBiometry()
  return info.isAvailable || info.deviceIsSecure
}

async function unlock(reason: string): Promise<boolean> {
  try {
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: 'Cancel',
      allowDeviceCredential: true, // PIN/pattern fallback: no one is locked out of their own record
      androidTitle: 'Unlock MedTrace',
      androidSubtitle: reason,
    })
    return true
  } catch {
    return false
  }
}

/** Turn the lock on (after proving the patient can unlock) or off. */
export async function setAppLock(enabled: boolean): Promise<boolean> {
  if (!isNative) return false
  if (enabled) {
    if (!(await unlock('Confirm it’s you to turn on the app lock'))) return false
    await SecureStorage.setItem(LOCK_KEY, 'on')
  } else {
    await SecureStorage.removeItem(LOCK_KEY)
  }
  return true
}

export function AppLock({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(isNative) // assume locked until checked, so nothing flashes
  const [checked, setChecked] = useState(!isNative)

  const attempt = useCallback(async () => {
    if (await unlock('Unlock to see your record')) setLocked(false)
  }, [])

  useEffect(() => {
    if (!isNative) return
    let backgroundedAt = 0
    let active = true

    void isAppLockEnabled().then((enabled) => {
      if (!active) return
      setChecked(true)
      if (enabled) void attempt()
      else setLocked(false)
    })

    const sub = App.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive) {
        backgroundedAt = Date.now()
        return
      }
      if (backgroundedAt && Date.now() - backgroundedAt > RELOCK_AFTER_MS && (await isAppLockEnabled())) {
        setLocked(true)
        void attempt()
      }
    })

    return () => {
      active = false
      void sub.then((s) => s.remove())
    }
  }, [attempt])

  if (!checked || locked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center"
        style={{ background: 'var(--ground)' }}>
        <span className="display" style={{ fontSize: 24, fontWeight: 600 }}>MedTrace</span>
        {checked && (
          <button type="button" className="btn btn-primary focus-ring" onClick={() => void attempt()}>
            Unlock
          </button>
        )}
      </div>
    )
  }
  return <>{children}</>
}
