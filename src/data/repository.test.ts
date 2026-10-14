/**
 * repository.test.ts — offline-first behaviour.
 *
 * Runs the real repository, real Dexie (on fake-indexeddb) and real sync code
 * against an in-memory server that reproduces the two server behaviours sync
 * depends on: last-write-wins by client edit time, and client_id deduplication on
 * append-only tables.
 */

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDB } from './local'
import type { ProfileRow } from './mappers'
import { RemoteError, type Remote } from './remote'
import { Repository } from './repository'
import { ImpactLevel, type DayRecord } from '../engine/types'

// ---------------------------------------------------------------------------
// In-memory server
// ---------------------------------------------------------------------------

class FakeServer implements Remote {
  tables: Record<string, Map<string, Record<string, unknown>>> = {
    day_entries: new Map(),
    treatments: new Map(),
    clinical_events: new Map(),
    custom_symptoms: new Map(),
    consents: new Map(),
    audit_events: new Map(),
  }
  profile: ProfileRow | null = null
  calls = 0
  /** When set, every call fails as if the network were down. */
  offline = false
  /** When set, the next call applies its write and THEN fails — a lost response. */
  dropNextResponse = false
  /** Rejects any day whose note equals this string, as a validation failure would. */
  rejectNote: string | null = null
  private clock = 0

  private tick() {
    this.calls++
    if (this.offline) throw new RemoteError('network down', true)
  }

  private maybeDrop() {
    if (this.dropNextResponse) {
      this.dropNextResponse = false
      throw new RemoteError('response lost', true)
    }
  }

  private stamp() {
    this.clock++
    return `2026-10-15T00:00:${String(this.clock).padStart(2, '0')}.000Z`
  }

  async upsertRecords(table: string, rows: Record<string, unknown>[], onConflict: string) {
    this.tick()
    for (const row of rows) {
      if (this.rejectNote && row.note === this.rejectNote) {
        throw new RemoteError('23514: check constraint violated', false)
      }
      const key = onConflict.split(',').map((c) => String(row[c])).join('|')
      const existing = this.tables[table].get(key)
      // Mirrors reject_stale_write(): an older client edit never overwrites a newer one.
      if (existing && String(row.client_updated_at) < String(existing.client_updated_at)) continue
      this.tables[table].set(key, {
        ...existing,
        ...row,
        id: existing?.id ?? row.id ?? `srv-${this.clock}`,
        updated_at: this.stamp(),
      })
    }
    this.maybeDrop()
  }

  async insertLogs(table: string, rows: Record<string, unknown>[]) {
    this.tick()
    for (const row of rows) {
      const id = String(row.client_id)
      if (!this.tables[table].has(id)) this.tables[table].set(id, row) // ON CONFLICT DO NOTHING
    }
    this.maybeDrop()
  }

  async updateProfile(_userId: string, patch: Partial<ProfileRow>) {
    this.tick()
    this.profile = { ...(this.profile as ProfileRow), ...patch }
  }

  async fetchSince(table: string, since: string | null) {
    this.tick()
    return [...this.tables[table].values()].filter((r) => !since || String(r.updated_at) >= since)
  }

  async fetchProfile() {
    this.tick()
    return this.profile
  }
}

// ---------------------------------------------------------------------------

const USER = 'user-1'
let dbCounter = 0

function day(date: string, patch: Partial<DayRecord> = {}): DayRecord {
  return {
    date,
    logged: true,
    bleeding: 'none',
    impact: ImpactLevel.None,
    symptoms: { pelvic_pain: { state: 'present', severity: 5 } },
    ...patch,
  }
}

let server: FakeServer
let repo: Repository

beforeEach(() => {
  server = new FakeServer()
  repo = new Repository(new LocalDB(`test-${++dbCounter}`), server, USER)
})

afterEach(() => repo.dispose())

describe('local-first writes', () => {
  it('a saved day is readable immediately, before any sync', async () => {
    server.offline = true
    await repo.saveDay(day('2026-10-14'))
    expect(await repo.getDay('2026-10-14')).toMatchObject({ date: '2026-10-14' })
    expect(server.tables.day_entries.size).toBe(0)
  })

  it('edits to the same day collapse into one queued upload', async () => {
    await repo.saveDay(day('2026-10-14', { impact: 1 }))
    await repo.saveDay(day('2026-10-14', { impact: 2 }))
    await repo.saveDay(day('2026-10-14', { impact: 3 }))
    expect(await repo.pendingCount()).toBe(1)

    await repo.sync()
    expect(server.tables.day_entries.size).toBe(1)
    expect([...server.tables.day_entries.values()][0].impact).toBe(3) // the latest state
  })

  it('clearing a day returns it to unknown and syncs as a soft delete', async () => {
    await repo.saveDay(day('2026-10-14'))
    await repo.sync()
    await repo.clearDay('2026-10-14')
    await repo.sync()

    expect(await repo.getDay('2026-10-14')).toBeUndefined()
    expect((await repo.loadRecord()).days).toHaveLength(0)
    expect([...server.tables.day_entries.values()][0].deleted_at).toBeTruthy()
  })
})

describe('offline and recovery', () => {
  it('keeps everything queued while offline and sends it on reconnect', async () => {
    server.offline = true
    await repo.saveDay(day('2026-10-12'))
    await repo.saveDay(day('2026-10-13'))
    await repo.recordConsent('core_tracking', true, '2026-10')
    await repo.sync()

    expect(repo.getSyncStatus().offline).toBe(true)
    expect(await repo.pendingCount()).toBe(3)

    server.offline = false
    await repo.sync()
    expect(await repo.pendingCount()).toBe(0)
    expect(server.tables.day_entries.size).toBe(2)
    expect(server.tables.consents.size).toBe(1)
  })

  it('replaying after a lost response is idempotent — no duplicate rows or consents', async () => {
    await repo.recordConsent('core_tracking', true, '2026-10')
    server.dropNextResponse = true // server applies it, client never hears back
    await repo.sync()
    expect(await repo.pendingCount()).toBe(1) // client thinks it failed

    await repo.sync() // retry
    expect(server.tables.consents.size).toBe(1)
    expect(await repo.pendingCount()).toBe(0)
  })

  it('a permanently rejected item is set aside and does not block the queue', async () => {
    server.rejectNote = 'bad'
    await repo.saveDay(day('2026-10-12', { note: 'bad' }))
    await repo.saveDay(day('2026-10-13'))
    await repo.sync()

    expect(server.tables.day_entries.size).toBe(1)
    expect(repo.getSyncStatus().rejected).toBe(1)
    expect(repo.getSyncStatus().pending).toBe(0)
  })
})

describe('pulling changes', () => {
  it('brings down rows written by another device', async () => {
    await server.upsertRecords(
      'day_entries',
      [{ id: 'other', user_id: USER, date: '2026-10-10', symptoms: {}, medications: [], client_updated_at: '2026-10-10T09:00:00Z', deleted_at: null }],
      'user_id,date',
    )
    await repo.sync()
    expect(await repo.getDay('2026-10-10')).toBeDefined()
  })

  it('does not overwrite an unsent local edit with an older server copy', async () => {
    await server.upsertRecords(
      'day_entries',
      [{ id: 'other', user_id: USER, date: '2026-10-10', impact: 0, symptoms: {}, medications: [], client_updated_at: '2026-10-10T09:00:00Z', deleted_at: null }],
      'user_id,date',
    )
    server.offline = true
    await repo.saveDay(day('2026-10-10', { impact: 3 }))
    server.offline = false
    // The pull would fetch the server's impact=0 copy; the pending local edit must survive.
    await repo.sync()
    expect((await repo.getDay('2026-10-10'))!.impact).toBe(3)
    expect([...server.tables.day_entries.values()][0].impact).toBe(3)
  })
})

describe('record assembly', () => {
  it('includes patient-defined symptoms in the tracked vocabulary', async () => {
    const key = await repo.addCustomSymptom('Sharp pain down left thigh')
    const record = await repo.loadRecord()
    expect(key).toBe('custom_sharp_pain_down_left_thigh')
    expect(record.trackedSymptomIds).toContain(key)
    expect(await repo.getCustomLabels()).toEqual({ [key]: 'Sharp pain down left thigh' })
  })

  it('gives a second custom symptom with the same wording a distinct key', async () => {
    const a = await repo.addCustomSymptom('Scar pain')
    const b = await repo.addCustomSymptom('Scar pain')
    expect(a).not.toBe(b)
  })

  it('merges profile patches made offline into one upload', async () => {
    server.profile = { user_id: USER } as ProfileRow
    server.offline = true
    await repo.updateProfile({ display_name: 'Maya' })
    await repo.updateProfile({ reminder: 'period' })
    expect(await repo.pendingCount()).toBe(1)
    server.offline = false
    await repo.sync()
    expect(server.profile).toMatchObject({ display_name: 'Maya', reminder: 'period' })
  })
})
