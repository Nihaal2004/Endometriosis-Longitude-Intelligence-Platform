/**
 * remote.ts — the narrow surface of the server that sync uses.
 *
 * Sync talks to this interface, not to supabase-js directly, so it can be tested
 * against an in-memory fake and so the backend could change without touching it.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProfileRow } from './mappers'
import type { LogTable, RecordTable } from './local'

export class RemoteError extends Error {
  constructor(
    message: string,
    /** True for network failures and 5xx; false for rejections that will never succeed. */
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'RemoteError'
  }
}

export interface Remote {
  upsertRecords(table: RecordTable, rows: Record<string, unknown>[], onConflict: string): Promise<void>
  insertLogs(table: LogTable, rows: Record<string, unknown>[]): Promise<void>
  updateProfile(userId: string, patch: Partial<ProfileRow>): Promise<void>
  fetchSince(table: RecordTable, since: string | null): Promise<Record<string, unknown>[]>
  fetchProfile(userId: string): Promise<ProfileRow | null>
}

/** Network failures and server errors are worth retrying; validation and RLS rejections are not. */
function classify(error: { message: string; code?: string } | null, status: number): RemoteError | null {
  if (!error) return null
  const retryable = status === 0 || status >= 500 || status === 408 || status === 429
  return new RemoteError(`${error.code ?? status}: ${error.message}`, retryable)
}

export function supabaseRemote(client: SupabaseClient): Remote {
  return {
    async upsertRecords(table, rows, onConflict) {
      try {
        const { error, status } = await client.from(table).upsert(rows, { onConflict })
        const e = classify(error, status)
        if (e) throw e
      } catch (err) {
        if (err instanceof RemoteError) throw err
        throw new RemoteError(String(err), true) // fetch itself failed: offline
      }
    },

    async insertLogs(table, rows) {
      try {
        // client_id is unique, so a replay after a dropped response is a no-op.
        const { error, status } = await client
          .from(table)
          .upsert(rows, { onConflict: 'client_id', ignoreDuplicates: true })
        const e = classify(error, status)
        if (e) throw e
      } catch (err) {
        if (err instanceof RemoteError) throw err
        throw new RemoteError(String(err), true)
      }
    },

    async updateProfile(userId, patch) {
      try {
        const { error, status } = await client.from('profiles').update(patch).eq('user_id', userId)
        const e = classify(error, status)
        if (e) throw e
      } catch (err) {
        if (err instanceof RemoteError) throw err
        throw new RemoteError(String(err), true)
      }
    },

    async fetchSince(table, since) {
      try {
        let query = client.from(table).select('*').order('updated_at', { ascending: true }).limit(5000)
        if (since) query = query.gte('updated_at', since)
        const { data, error, status } = await query
        const e = classify(error, status)
        if (e) throw e
        return (data ?? []) as Record<string, unknown>[]
      } catch (err) {
        if (err instanceof RemoteError) throw err
        throw new RemoteError(String(err), true)
      }
    },

    async fetchProfile(userId) {
      try {
        const { data, error, status } = await client
          .from('profiles')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle()
        const e = classify(error, status)
        if (e) throw e
        return (data as ProfileRow | null) ?? null
      } catch (err) {
        if (err instanceof RemoteError) throw err
        throw new RemoteError(String(err), true)
      }
    },
  }
}
