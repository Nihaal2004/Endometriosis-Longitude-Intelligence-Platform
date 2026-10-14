/**
 * bridge.ts — native event wiring, started once at app launch.
 *
 * - Deep links: a confirmation or reset email opens the app with ?code=, which is
 *   exchanged for a session. A reset link's verifier is tagged by supabase-js, so
 *   the exchange emits PASSWORD_RECOVERY and the router shows the reset screen.
 * - Back button: goes back through the app's history, and only leaves the app
 *   from the top level — never mid-form.
 */

import { App } from '@capacitor/app'
import { supabase } from '../data/supabase'
import { isNative, parseAuthCallback } from './platform'

let started = false

export function startNativeBridge(onAuthError: (message: string) => void): void {
  if (!isNative || started) return
  started = true

  void App.addListener('appUrlOpen', async ({ url }) => {
    const { code, error } = parseAuthCallback(url)
    if (error) {
      onAuthError(
        /expired|invalid/i.test(error)
          ? 'That link has expired or was already used. Sign in, or request a new one.'
          : 'That link couldn’t be used. Please try again.',
      )
      return
    }
    if (!code || !supabase) return
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError) {
      // The email IS confirmed server-side even if this device didn't start the
      // sign-up (so has no PKCE verifier). The patient can simply sign in.
      onAuthError('Your email is confirmed. Please sign in to continue.')
    }
  })

  void App.addListener('backButton', ({ canGoBack }) => {
    const topLevel = ['#/today', '#/login', '#/onboarding', '#/'].some((h) => window.location.hash === h)
    if (canGoBack && !topLevel) window.history.back()
    else void App.minimizeApp()
  })
}
