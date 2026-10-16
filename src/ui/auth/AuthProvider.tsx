/**
 * AuthProvider — session state and the auth actions the screens call.
 *
 * Error messages from Supabase are translated into plain language here, once,
 * so no screen ever shows "AuthApiError: invalid_grant" to a patient.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AuthError, Session, User } from '@supabase/supabase-js'
import { authRedirectUrl, supabase } from '../../data/supabase'
import { startNativeBridge } from '../../native/bridge'

interface AuthContextValue {
  session: Session | null
  user: User | null
  /** True until the stored session has been checked on startup. */
  loading: boolean
  /** True after the patient arrives from a password-reset email. */
  recovering: boolean
  configured: boolean
  /** A message for the sign-in screen, e.g. after an expired email link opened the app. */
  notice: string | null
  clearNotice(): void
  signIn(email: string, password: string): Promise<AuthResult>
  signUp(email: string, password: string, ageConfirmed18: boolean): Promise<AuthResult>
  sendPasswordReset(email: string): Promise<AuthResult>
  updatePassword(password: string): Promise<AuthResult>
  resendConfirmation(email: string): Promise<AuthResult>
  signOut(): Promise<void>
}

export type AuthResult = { ok: true; needsConfirmation?: boolean } | { ok: false; message: string }

const AuthContext = createContext<AuthContextValue | null>(null)

/** Plain-language versions of the errors a patient can actually hit. */
export function friendlyAuthError(error: AuthError | Error | null | undefined): string {
  if (!error) return 'Something went wrong. Please try again.'
  const code = (error as AuthError).code ?? ''
  const msg = error.message.toLowerCase()

  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return 'That email and password don’t match. Check both and try again.'
  }
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return 'Please confirm your email first. We sent you a link when you registered.'
  }
  if (code === 'user_already_exists' || msg.includes('already registered')) {
    return 'An account with this email already exists. Try signing in, or reset your password.'
  }
  if (code === 'weak_password' || msg.includes('password should')) {
    return 'Choose a stronger password: at least 8 characters, with both letters and numbers.'
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || msg.includes('rate limit')) {
    return 'Too many attempts in a short time. Please wait a few minutes and try again.'
  }
  if (code === 'same_password') {
    return 'Your new password must be different from your current one.'
  }
  if (msg.includes('failed to fetch') || msg.includes('network')) {
    return 'Can’t reach the server. Check your connection and try again.'
  }
  return 'Something went wrong. Please try again.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [recovering, setRecovering] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    startNativeBridge(setNotice)
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_OUT') setRecovering(false)
      // Strip ?code=... left by a confirmation or reset link, keeping the route.
      if (window.location.search.includes('code=')) {
        window.history.replaceState(null, '', window.location.pathname + window.location.hash)
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      recovering,
      configured: Boolean(supabase),
      notice,
      clearNotice: () => setNotice(null),

      async signIn(email, password) {
        if (!supabase) return { ok: false, message: 'Accounts are not configured for this build.' }
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        return error ? { ok: false, message: friendlyAuthError(error) } : { ok: true }
      },

      async signUp(email, password, ageConfirmed18) {
        if (!supabase) return { ok: false, message: 'Accounts are not configured for this build.' }
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: authRedirectUrl(),
            data: { age_confirmed_18: ageConfirmed18 },
          },
        })
        if (error) return { ok: false, message: friendlyAuthError(error) }
        // With confirmation on, no session is issued until the link is clicked.
        return { ok: true, needsConfirmation: !data.session }
      },

      async sendPasswordReset(email) {
        if (!supabase) return { ok: false, message: 'Accounts are not configured for this build.' }
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: authRedirectUrl(),
        })
        // Report success whether or not the email has an account, so this form
        // can't be used to discover who is registered. Only a rate limit is shown,
        // because the patient needs to know to wait.
        if (error && /rate limit/i.test(error.message)) {
          return { ok: false, message: friendlyAuthError(error) }
        }
        return { ok: true }
      },

      async updatePassword(password) {
        if (!supabase) return { ok: false, message: 'Accounts are not configured for this build.' }
        const { error } = await supabase.auth.updateUser({ password })
        if (error) return { ok: false, message: friendlyAuthError(error) }
        setRecovering(false)
        return { ok: true }
      },

      async resendConfirmation(email) {
        if (!supabase) return { ok: false, message: 'Accounts are not configured for this build.' }
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email: email.trim(),
          options: { emailRedirectTo: authRedirectUrl() },
        })
        return error ? { ok: false, message: friendlyAuthError(error) } : { ok: true }
      },

      async signOut() {
        if (!supabase) return
        await supabase.auth.signOut()
      },
    }),
    [session, loading, recovering, notice],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
