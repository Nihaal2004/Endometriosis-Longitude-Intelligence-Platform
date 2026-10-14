/**
 * supabase.ts — the one Supabase client.
 *
 * Only the public anon key ever reaches the client. Every table is protected by
 * row-level security, so the anon key grants nothing beyond what a signed-in
 * patient may do with their own rows. The service-role key never belongs here.
 *
 * If the environment is not configured, `supabase` is null and the app runs in
 * demo mode only — useful for presenting without a backend.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Where confirmation and password-reset emails send the patient back to. */
export function authRedirectUrl(): string {
  // Native builds override this with the app's deep-link scheme (Capacitor milestone).
  const native = (globalThis as { __MEDTRACE_NATIVE_REDIRECT__?: string }).__MEDTRACE_NATIVE_REDIRECT__
  if (native) return native
  // No hash: the PKCE code arrives as ?code=..., which a HashRouter route would swallow.
  return `${window.location.origin}${window.location.pathname}`
}

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null

export const isBackendConfigured = supabase !== null
