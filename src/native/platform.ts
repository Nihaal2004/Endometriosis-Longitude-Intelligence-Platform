/**
 * platform.ts — the seam between the web app and the phone.
 *
 * Everything native goes through here, so the rest of the app never imports a
 * Capacitor plugin directly and keeps running unchanged in a browser.
 */

import { Capacitor } from '@capacitor/core'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'

export const isNative = Capacitor.isNativePlatform()

/** Where confirmation and reset emails return to on a phone. Must match AndroidManifest and Supabase's allow-list. */
export const NATIVE_AUTH_REDIRECT = 'com.medtrace.app://auth/callback'

/**
 * Session storage for the auth client.
 *
 * On a phone the refresh token lives in the Android Keystore / iOS Keychain, not
 * in WebView localStorage — which is readable by anything with file access to the
 * app's data and which iOS may evict under storage pressure, signing the patient
 * out at random. On the web, localStorage is the only option.
 */
export const authStorage: {
  getItem(key: string): Promise<string | null> | string | null
  setItem(key: string, value: string): Promise<void> | void
  removeItem(key: string): Promise<void> | void
} = isNative
  ? {
      getItem: (key) => SecureStorage.getItem(key),
      setItem: (key, value) => SecureStorage.setItem(key, value),
      removeItem: (key) => SecureStorage.removeItem(key),
    }
  : {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
      removeItem: (key) => window.localStorage.removeItem(key),
    }

/** Pull the PKCE code (or an error) out of a deep link like com.medtrace.app://auth/callback?code=… */
export function parseAuthCallback(url: string): { code?: string; error?: string } {
  if (!url.startsWith(NATIVE_AUTH_REDIRECT)) return {}
  const query = url.slice(url.indexOf('?') + 1).split('#')[0]
  const params = new URLSearchParams(query)
  const error = params.get('error_description') ?? params.get('error') ?? undefined
  const code = params.get('code') ?? undefined
  return { code, error }
}
