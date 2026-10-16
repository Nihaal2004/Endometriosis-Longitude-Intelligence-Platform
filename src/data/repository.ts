/**
 * repository.ts — the only data API screens use.
 *
 * Every write commits to the local store and the outbox in one transaction, then
 * returns. Syncing happens afterwards, in the background. A patient tapping Save
 * on a train with no signal loses nothing and waits for nothing.
 */

import { DEFAULT_TRACKED_SYMPTOMS, reportLabel } from '../engine/symptoms'
import type {
  ClinicalEvent,
  DayRecord,
  PatientRecord,
  SymptomDomain,
  TreatmentEpisode,
} from '../engine/types'
import { LocalDB, localTableFor, type LogTable, type OutboxItem, type RecordTable } from './local'
import {
  customSymptomKey,
  dayToRow,
  eventToRow,
  rowToDay,
  rowToEvent,
  rowToProfile,
  rowToTreatment,
  treatmentToRow,
  type CustomSymptomRow,
  type DayEntryRow,
  type ProfileRow,
} from './mappers'
import type { Remote } from './remote'
import { flushOutbox, pullChanges, type FlushResult } from './sync'

export type ConsentPurpose =
  | 'core_tracking'
  | 'sexual_health_module'
  | 'fertility_module'
  | 'research_use'
  | 'ai_symptom_wording'

export interface SyncStatus {
  pending: number
  rejected: number
  offline: boolean
  lastSyncedAt: string | null
  syncing: boolean
}

const uuid = () => crypto.randomUUID()
const nowIso = () => new Date().toISOString()

export function defaultProfileRow(userId: string): ProfileRow {
  return {
    user_id: userId,
    display_name: null,
    age_range: null,
    diagnosis_status: 'undiagnosed',
    symptom_onset_year: null,
    family_history: null,
    previous_pelvic_surgery: null,
    prior_labels: [],
    usual_cycle_min: null,
    usual_cycle_max: null,
    cycle_regularity: null,
    age_at_menarche: null,
    enabled_domains: ['pain', 'bowel', 'urinary', 'systemic'],
    tracked_symptom_ids: [],
    reminder: 'daily',
    reminder_time: null,
    age_confirmed_18: false,
    onboarded_at: null,
  }
}

export class Repository {
  private listeners = new Set<() => void>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private syncing: Promise<void> | null = null
  private status: SyncStatus = {
    pending: 0,
    rejected: 0,
    offline: false,
    lastSyncedAt: null,
    syncing: false,
  }

  constructor(
    readonly db: LocalDB,
    private readonly remote: Remote | null,
    readonly userId: string,
    private readonly displayNameFallback = 'You',
  ) {}

  // -------------------------------------------------------------------------
  // Change notification
  // -------------------------------------------------------------------------

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  getSyncStatus(): SyncStatus {
    return this.status
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getProfileRow(): Promise<ProfileRow> {
    return (await this.db.profile.get(this.userId)) ?? defaultProfileRow(this.userId)
  }

  /**
   * Whether this device holds the account's profile yet. False on a fresh device
   * until the first pull completes — and the router must wait for it, or a
   * returning patient would be sent through onboarding again.
   */
  async hasLocalProfile(): Promise<boolean> {
    return (await this.db.profile.get(this.userId)) !== undefined
  }

  async getDayRow(date: string): Promise<DayEntryRow | undefined> {
    const row = await this.db.days.get(date)
    return row && !row.deleted_at ? row : undefined
  }

  async getDay(date: string): Promise<DayRecord | undefined> {
    const row = await this.db.days.get(date)
    return row ? (rowToDay(row) ?? undefined) : undefined
  }

  /** Patient-defined symptoms, as a key → label map for display. */
  async getCustomLabels(): Promise<Record<string, string>> {
    const rows = await this.db.customSymptoms.toArray()
    const out: Record<string, string> = {}
    for (const r of rows) if (!r.deleted_at) out[r.symptom_key] = r.label
    return out
  }

  /** The same map as the clinician sees it: a confirmed clinical term, with the patient's words beside it. */
  async getReportLabels(): Promise<Record<string, string>> {
    const rows = await this.db.customSymptoms.toArray()
    const out: Record<string, string> = {}
    for (const r of rows) if (!r.deleted_at) out[r.symptom_key] = reportLabel(r.label, r.clinical_term)
    return out
  }

  /** Confirmed clinical terms of patient-defined symptoms, by key. */
  async getCustomTerms(): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    for (const r of await this.db.customSymptoms.toArray()) {
      if (!r.deleted_at && r.clinical_term) out[r.symptom_key] = r.clinical_term
    }
    return out
  }

  async getCustomSymptoms(): Promise<CustomSymptomRow[]> {
    return (await this.db.customSymptoms.toArray()).filter((r) => !r.deleted_at)
  }

  /** Assemble the engine's input from the local store. */
  async loadRecord(): Promise<PatientRecord> {
    const [profileRow, dayRows, treatmentRows, eventRows, customRows] = await Promise.all([
      this.getProfileRow(),
      this.db.days.toArray(),
      this.db.treatments.toArray(),
      this.db.events.toArray(),
      this.db.customSymptoms.toArray(),
    ])

    const days = dayRows
      .map(rowToDay)
      .filter((d): d is DayRecord => d !== null)
      .sort((a, b) => a.date.localeCompare(b.date))

    const tracked = profileRow.tracked_symptom_ids.length
      ? profileRow.tracked_symptom_ids
      : DEFAULT_TRACKED_SYMPTOMS

    return {
      profile: rowToProfile(profileRow, this.displayNameFallback),
      days,
      treatments: treatmentRows.map(rowToTreatment).filter((t): t is TreatmentEpisode => t !== null),
      clinicalEvents: eventRows.map(rowToEvent).filter((e): e is ClinicalEvent => e !== null),
      trackedSymptomIds: [
        ...new Set([...tracked, ...customRows.filter((r) => !r.deleted_at).map((r) => r.symptom_key)]),
      ],
    }
  }

  async treatmentsList(): Promise<TreatmentEpisode[]> {
    return (await this.db.treatments.toArray())
      .map(rowToTreatment)
      .filter((t): t is TreatmentEpisode => t !== null)
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
  }

  async eventsList(): Promise<ClinicalEvent[]> {
    return (await this.db.events.toArray())
      .map(rowToEvent)
      .filter((e): e is ClinicalEvent => e !== null)
      .sort((a, b) => b.date.localeCompare(a.date))
  }

  // -------------------------------------------------------------------------
  // Writes — local first, then queued
  // -------------------------------------------------------------------------

  private async enqueueRecord(table: RecordTable, key: string) {
    // One queued item per row is enough: the flush sends the row's current state.
    const existing = await this.db.outbox.where('[table+key]').equals([table, key]).first()
    if (existing && !existing.dead) return
    const item: OutboxItem = { kind: 'record', table, key, enqueuedAt: nowIso(), attempts: 0 }
    await this.db.outbox.add(item)
  }

  private async enqueueLog(table: LogTable, payload: Record<string, unknown>) {
    const clientId = uuid()
    await this.db.outbox.add({
      kind: 'log',
      table,
      key: clientId,
      payload: { ...payload, client_id: clientId },
      enqueuedAt: nowIso(),
      attempts: 0,
    })
  }

  private afterWrite() {
    this.emit()
    this.scheduleFlush()
  }

  async saveDay(day: DayRecord): Promise<void> {
    await this.db.transaction('rw', this.db.days, this.db.outbox, async () => {
      const existing = await this.db.days.get(day.date)
      const row = dayToRow(day, existing?.id ?? uuid(), nowIso())
      if (existing?.revision) row.revision = existing.revision
      await this.db.days.put(row)
      await this.enqueueRecord('day_entries', day.date)
    })
    this.afterWrite()
  }

  /** "Clear this day": the day returns to unknown. Soft delete, so it syncs and is archived. */
  async clearDay(date: string): Promise<void> {
    await this.db.transaction('rw', this.db.days, this.db.outbox, async () => {
      const existing = await this.db.days.get(date)
      if (!existing) return
      const stamp = nowIso()
      await this.db.days.put({ ...existing, deleted_at: stamp, client_updated_at: stamp })
      await this.enqueueRecord('day_entries', date)
    })
    this.afterWrite()
  }

  async saveTreatment(t: Omit<TreatmentEpisode, 'id'> & { id?: string }): Promise<string> {
    const id = t.id ?? uuid()
    await this.db.transaction('rw', this.db.treatments, this.db.outbox, async () => {
      await this.db.treatments.put(treatmentToRow({ ...t, id }, nowIso()))
      await this.enqueueRecord('treatments', id)
    })
    this.afterWrite()
    return id
  }

  async deleteTreatment(id: string): Promise<void> {
    await this.softDelete('treatments', id)
  }

  async saveEvent(e: Omit<ClinicalEvent, 'id'> & { id?: string }): Promise<string> {
    const id = e.id ?? uuid()
    await this.db.transaction('rw', this.db.events, this.db.outbox, async () => {
      await this.db.events.put(eventToRow({ ...e, id }, nowIso()))
      await this.enqueueRecord('clinical_events', id)
    })
    this.afterWrite()
    return id
  }

  async deleteEvent(id: string): Promise<void> {
    await this.softDelete('clinical_events', id)
  }

  private async softDelete(table: RecordTable, key: string) {
    const target = localTableFor(this.db, table)
    await this.db.transaction('rw', target, this.db.outbox, async () => {
      const existing = await target.get(key)
      if (!existing) return
      const stamp = nowIso()
      await target.put({ ...existing, deleted_at: stamp, client_updated_at: stamp })
      await this.enqueueRecord(table, key)
    })
    this.afterWrite()
  }

  /** "+ Add my own symptom". Returns the symptom key, which works anywhere a vocabulary id does. */
  async addCustomSymptom(
    label: string,
    domain: SymptomDomain = 'pain',
    graded = true,
    clinicalTerm: string | null = null,
  ): Promise<string> {
    const clean = label.trim().slice(0, 60)
    if (!clean) throw new Error('A symptom needs a name')
    let key = customSymptomKey(clean)
    const taken = new Set((await this.db.customSymptoms.toArray()).map((r) => r.symptom_key))
    for (let n = 2; taken.has(key); n++) key = `${customSymptomKey(clean).slice(0, 52)}_${n}`

    await this.db.transaction('rw', this.db.customSymptoms, this.db.outbox, async () => {
      await this.db.customSymptoms.put({
        id: uuid(),
        symptom_key: key,
        label: clean,
        domain,
        graded,
        clinical_term: clinicalTerm,
        client_updated_at: nowIso(),
        deleted_at: null,
      })
      await this.enqueueRecord('custom_symptoms', key)
    })
    this.afterWrite()
    return key
  }

  async updateProfile(patch: Partial<Omit<ProfileRow, 'user_id'>>): Promise<void> {
    await this.db.transaction('rw', this.db.profile, this.db.outbox, async () => {
      const current = (await this.db.profile.get(this.userId)) ?? defaultProfileRow(this.userId)
      await this.db.profile.put({ ...current, ...patch, user_id: this.userId })
      // Profile patches merge: fold into any unsent patch rather than queueing another.
      const pending = await this.db.outbox
        .where('[table+key]')
        .equals(['profiles', this.userId])
        .filter((i) => !i.dead)
        .first()
      if (pending && pending.kind === 'profile') {
        await this.db.outbox.put({ ...pending, payload: { ...pending.payload, ...patch } })
      } else {
        await this.db.outbox.add({
          kind: 'profile',
          table: 'profiles',
          key: this.userId,
          payload: patch,
          enqueuedAt: nowIso(),
          attempts: 0,
        })
      }
    })
    this.afterWrite()
  }

  /** Consent is an append-only event: granting and withdrawing are both new records. */
  async recordConsent(purpose: ConsentPurpose, granted: boolean, noticeVersion: string): Promise<void> {
    await this.db.transaction('rw', this.db.outbox, async () => {
      await this.enqueueLog('consents', { purpose, granted, notice_version: noticeVersion })
    })
    this.afterWrite()
  }

  async audit(action: string, target?: string): Promise<void> {
    await this.enqueueLog('audit_events', { actor: 'patient', action, target: target ?? null })
    this.scheduleFlush()
  }

  // -------------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------------

  scheduleFlush(delayMs = 800) {
    if (!this.remote) return
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => void this.sync(), delayMs)
  }

  /** Push the outbox, then pull. Concurrent calls share one run. */
  sync(): Promise<void> {
    if (!this.remote) return Promise.resolve()
    if (this.syncing) return this.syncing
    this.status = { ...this.status, syncing: true }
    this.emit()

    this.syncing = (async () => {
      let flush: FlushResult | null = null
      try {
        flush = await flushOutbox(this.db, this.remote!, this.userId)
        if (!flush.offline) {
          const applied = await pullChanges(this.db, this.remote!, this.userId)
          if (applied > 0) this.emit()
        }
      } catch {
        flush = { sent: 0, rejected: 0, remaining: await this.pendingCount(), offline: true }
      } finally {
        const rejected = await this.db.outbox.filter((i) => Boolean(i.dead)).count()
        this.status = {
          pending: flush?.remaining ?? (await this.pendingCount()),
          rejected,
          offline: flush?.offline ?? true,
          lastSyncedAt: flush && !flush.offline ? nowIso() : this.status.lastSyncedAt,
          syncing: false,
        }
        this.syncing = null
        this.emit()
      }
    })()
    return this.syncing
  }

  async pendingCount(): Promise<number> {
    return this.db.outbox.filter((i) => !i.dead).count()
  }

  dispose() {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.listeners.clear()
    this.db.close()
  }
}
