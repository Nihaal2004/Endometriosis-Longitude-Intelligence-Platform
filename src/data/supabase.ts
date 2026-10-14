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
import { authStorage, isNative, NATIVE_AUTH_REDIRECT } from '../native/platform'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Where confirmation and password-reset emails send the patient back to. */
export function authRedirectUrl(): string {
  if (isNative) return NATIVE_AUTH_REDIRECT
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
          storage: authStorage,
          // On the web the confirmation link lands on our own URL with ?code=.
          // On a phone it arrives as a deep link, handled in native/bridge.ts.
          detectSessionInUrl: !isNative,
        },
      })
    : null

export const isBackendConfigured = supabase !== null
