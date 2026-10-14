/**
 * reminders.ts — check-in reminders on the phone.
 *
 * Every reminder says only "Your check-in is ready". Never a symptom name, never
 * the word "period", never a reference to missed days — a notification is visible
 * on a lock screen to anyone holding the phone.
 *
 * "Only around my period" deliberately does not predict a period. It reminds while
 * one is under way: after a day with bleeding logged, there is a reminder the next
 * evening, until bleeding stops being logged.
 */

import { LocalNotifications } from '@capacitor/local-notifications'
import { addDays } from '../engine/cycles'
import { BLEEDING_FLOW_LEVELS, type DayRecord } from '../engine/types'
import { isNative } from './platform'

export type ReminderPreference = 'daily' | 'period' | 'none'

const DAILY_ID = 1001
const PERIOD_ID = 1002
export const REMINDER_TEXT = { title: 'MedTrace', body: 'Your check-in is ready.' }

/** Whether a period-mode reminder is due tomorrow: bleeding logged today or yesterday. */
export function periodReminderDue(days: DayRecord[], today: string): boolean {
  const recent = new Set([today, addDays(today, -1)])
  return days.some(
    (d) => recent.has(d.date) && d.bleeding !== undefined && BLEEDING_FLOW_LEVELS.includes(d.bleeding),
  )
}

/** "20:00" -> [20, 0], falling back to 8 pm for anything malformed. */
export function parseReminderTime(time: string | null | undefined): [number, number] {
  const match = /^(\d{1,2}):(\d{2})/.exec(time ?? '')
  if (!match) return [20, 0]
  const h = Number(match[1])
  const m = Number(match[2])
  return h >= 0 && h < 24 && m >= 0 && m < 60 ? [h, m] : [20, 0]
}

export async function requestReminderPermission(): Promise<boolean> {
  if (!isNative) return false
  const current = await LocalNotifications.checkPermissions()
  if (current.display === 'granted') return true
  const asked = await LocalNotifications.requestPermissions()
  return asked.display === 'granted'
}

/** Bring scheduled notifications in line with the preference and the record. Safe to call often. */
export async function syncReminders(
  preference: ReminderPreference,
  days: DayRecord[],
  today: string,
  time?: string | null,
): Promise<void> {
  if (!isNative) return
  await LocalNotifications.cancel({ notifications: [{ id: DAILY_ID }, { id: PERIOD_ID }] })
  if (preference === 'none') return
  if ((await LocalNotifications.checkPermissions()).display !== 'granted') return

  const [hour, minute] = parseReminderTime(time)

  if (preference === 'daily') {
    await LocalNotifications.schedule({
      notifications: [{
        id: DAILY_ID,
        ...REMINDER_TEXT,
        schedule: { on: { hour, minute }, allowWhileIdle: true },
      }],
    })
    return
  }

  if (periodReminderDue(days, today)) {
    const [y, m, d] = addDays(today, 1).split('-').map(Number)
    await LocalNotifications.schedule({
      notifications: [{
        id: PERIOD_ID,
        ...REMINDER_TEXT,
        schedule: { at: new Date(y, m - 1, d, hour, minute), allowWhileIdle: true },
      }],
    })
  }
}
