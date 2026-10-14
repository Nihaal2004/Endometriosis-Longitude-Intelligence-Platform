/**
 * sync.ts — moving the local store to and from the server.
 *
 * PUSH (flush): the outbox is drained in order. For record tables, the item only
 * names which row changed; the CURRENT local row is sent. Ten edits to one day
 * become one upload, and replaying the queue after a dropped connection resends
 * the same final state — idempotent by construction. Append-only logs carry their
 * own payload and a client_id the server deduplicates on.
 *
 * Conflicts are last-write-wins by the device's edit time, enforced server-side
 * (reject_stale_write). Every overwritten version is kept in day_entry_revisions.
 *
 * PULL: rows changed on the server since the last pull are copied down, except
 * where this device still has an unsent edit to the same row — the local edit
 * wins until it has been sent, and the server then decides by edit time.
 */

import { localTableFor, type LocalDB, type OutboxItem, type RecordTable } from './local'
import { RemoteError, type Remote } from './remote'

const RECORD_TABLES: RecordTable[] = ['day_entries', 'treatments', 'clinical_events', 'custom_symptoms']

/** Conflict target per table — the natural key the server deduplicates on. */
const CONFLICT_TARGET: Record<RecordTable, string> = {
  day_entries: 'user_id,date',
  treatments: 'id',
  clinical_events: 'id',
  custom_symptoms: 'user_id,symptom_key',
}

/** Give up on an item after this many retryable failures, so one bad row can't block the queue forever. */
const MAX_ATTEMPTS = 8

export interface FlushResult {
  sent: number
  /** Permanently rejected (validation or permission). Kept, flagged, never retried. */
  rejected: number
  /** Still queued because the network failed. */
  remaining: number
  offline: boolean
}

/** Server-managed columns that must not be sent back up. */
function forUpload(table: RecordTable, row: Record<string, unknown>, userId: string): Record<string, unknown> {
  const { updated_at: _u, created_at: _c, revision: _r, ...rest } = row
  void _u
  void _c
  void _r
  const out: Record<string, unknown> = { ...rest, user_id: userId }
  // A day's identity is (user, date). Its uuid is assigned by whichever device
  // created it first; never send ours, or a second device would try to change
  // the primary key of an existing row.
  if (table === 'day_entries') delete out.id
  if (table === 'custom_symptoms') delete out.id
  return out
}

export async function flushOutbox(db: LocalDB, remote: Remote, userId: string): Promise<FlushResult> {
  const items = (await db.outbox.orderBy('seq').toArray()).filter((i) => !i.dead)
  let sent = 0
  let rejected = 0

  for (const item of items) {
    try {
      await send(db, remote, userId, item)
      await db.outbox.delete(item.seq!)
      sent++
    } catch (err) {
      const retryable = err instanceof RemoteError ? err.retryable : false
      const attempts = item.attempts + 1
      if (!retryable || attempts >= MAX_ATTEMPTS) {
        await db.outbox.update(item.seq!, { dead: true, attempts, lastError: String(err) })
        rejected++
        continue
      }
      await db.outbox.update(item.seq!, { attempts, lastError: String(err) })
      // Offline: stop here and keep order. Everything after this waits.
      const remaining = await db.outbox.filter((i) => !i.dead).count()
      return { sent, rejected, remaining, offline: true }
    }
  }

  const remaining = await db.outbox.filter((i) => !i.dead).count()
  return { sent, rejected, remaining, offline: false }
}

async function send(db: LocalDB, remote: Remote, userId: string, item: OutboxItem): Promise<void> {
  if (item.kind === 'record') {
    const row = await localTableFor(db, item.table).get(item.key)
    if (!row) return // superseded locally; nothing to send
    await remote.upsertRecords(
      item.table,
      [forUpload(item.table, row as Record<string, unknown>, userId)],
      CONFLICT_TARGET[item.table],
    )
    return
  }
  if (item.kind === 'log') {
    await remote.insertLogs(item.table, [{ ...item.payload, user_id: userId }])
    return
  }
  await remote.updateProfile(userId, item.payload)
}

/** Pull server changes into the local store. Returns the number of rows applied. */
export async function pullChanges(db: LocalDB, remote: Remote, userId: string): Promise<number> {
  let applied = 0

  const pendingKeys = new Set(
    (await db.outbox.filter((i) => !i.dead).toArray()).map((i) => `${i.table}:${i.key}`),
  )

  for (const table of RECORD_TABLES) {
    const metaKey = `pulled:${table}`
    const since = (await db.meta.get(metaKey))?.value ?? null
    const rows = await remote.fetchSince(table, since)
    if (rows.length === 0) continue

    const target = localTableFor(db, table)
    let latest = since
    await db.transaction('rw', target, async () => {
      for (const row of rows) {
        const key = String(table === 'day_entries' ? row.date : table === 'custom_symptoms' ? row.symptom_key : row.id)
        if (!pendingKeys.has(`${table}:${key}`)) {
          await target.put(row)
          applied++
        }
        const u = String(row.updated_at)
        if (!latest || u > latest) latest = u
      }
    })
    if (latest) await db.meta.put({ key: metaKey, value: latest })
  }

  if (!pendingKeys.has(`profiles:${userId}`)) {
    const profile = await remote.fetchProfile(userId)
    if (profile) {
      await db.profile.put(profile)
      applied++
    }
  }

  return applied
}
