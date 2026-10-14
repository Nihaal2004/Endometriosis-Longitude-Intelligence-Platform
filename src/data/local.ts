/**
 * local.ts — the on-device store.
 *
 * Every screen reads from here, never from the network, so logging never waits on
 * connectivity. Writes land here first and are queued in `outbox` for sync.
 *
 * One database per account (`medtrace-<userId>`), deleted on sign-out, so two
 * people sharing a phone never see each other's records.
 */

import Dexie, { type Table } from 'dexie'
import type {
  ClinicalEventRow,
  CustomSymptomRow,
  DayEntryRow,
  ProfileRow,
  TreatmentRow,
} from './mappers'

/** Tables whose rows are synced as current state (idempotent upsert of the latest row). */
export type RecordTable = 'day_entries' | 'treatments' | 'clinical_events' | 'custom_symptoms'

/** Append-only tables: each queued item is one immutable event, sent exactly once. */
export type LogTable = 'consents' | 'audit_events'

export type OutboxItem =
  | {
      seq?: number
      kind: 'record'
      table: RecordTable
      /** Local primary key: the date for day entries, the id or symptom key otherwise. */
      key: string
      enqueuedAt: string
      attempts: number
      lastError?: string
      dead?: boolean
    }
  | {
      seq?: number
      kind: 'log'
      table: LogTable
      key: string // client_id
      payload: Record<string, unknown>
      enqueuedAt: string
      attempts: number
      lastError?: string
      dead?: boolean
    }
  | {
      seq?: number
      kind: 'profile'
      table: 'profiles'
      key: string // user_id
      payload: Partial<ProfileRow>
      enqueuedAt: string
      attempts: number
      lastError?: string
      dead?: boolean
    }

export interface MetaRow {
  key: string
  value: string
}

export class LocalDB extends Dexie {
  days!: Table<DayEntryRow, string>
  treatments!: Table<TreatmentRow, string>
  events!: Table<ClinicalEventRow, string>
  customSymptoms!: Table<CustomSymptomRow, string>
  profile!: Table<ProfileRow, string>
  outbox!: Table<OutboxItem, number>
  meta!: Table<MetaRow, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      days: 'date',
      treatments: 'id',
      events: 'id',
      customSymptoms: 'symptom_key',
      profile: 'user_id',
      outbox: '++seq, [table+key]',
      meta: 'key',
    })
  }
}

export function localDbName(userId: string): string {
  return `medtrace-${userId}`
}

export function openLocal(userId: string): LocalDB {
  return new LocalDB(localDbName(userId))
}

/** Remove every trace of an account from the device. Called on sign-out and erasure. */
export async function destroyLocal(userId: string): Promise<void> {
  await Dexie.delete(localDbName(userId))
}

/** Map a record table to its local Dexie table. */
export function localTableFor(db: LocalDB, table: RecordTable): Table<any, string> {
  switch (table) {
    case 'day_entries':
      return db.days
    case 'treatments':
      return db.treatments
    case 'clinical_events':
      return db.events
    case 'custom_symptoms':
      return db.customSymptoms
  }
}
