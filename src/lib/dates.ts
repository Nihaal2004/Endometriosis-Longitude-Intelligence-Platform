/**
 * dates.ts — the patient's calendar date.
 *
 * A day log belongs to the date on the patient's own calendar, so "today" must
 * come from the device's time zone — never from `toISOString()`, which is UTC. In
 * India (UTC+05:30) `new Date().toISOString().slice(0, 10)` returns *yesterday*
 * for every log made between midnight and 05:30, which is precisely when
 * night-time pain gets recorded.
 *
 * Date arithmetic on ISO strings stays in engine/cycles.ts (UTC-based, which is
 * correct for date-only math). This file only answers "what date is it here?".
 */

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone?: string): Intl.DateTimeFormat {
  const key = timeZone ?? 'local'
  let f = formatterCache.get(key)
  if (!f) {
    // en-CA formats as yyyy-mm-dd, which is exactly the ISO date we store.
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    formatterCache.set(key, f)
  }
  return f
}

/** The calendar date (yyyy-mm-dd) of an instant, in the given or device time zone. */
export function localDateString(instant: Date = new Date(), timeZone?: string): string {
  return formatter(timeZone).format(instant)
}

/** Today's date on the patient's calendar. */
export function localToday(timeZone?: string): string {
  return localDateString(new Date(), timeZone)
}

/** True if `date` is after today on the patient's calendar. Future days cannot be logged. */
export function isFutureDate(date: string, today: string = localToday()): boolean {
  return date > today
}

/** Human label for a date relative to today: "Today", "Yesterday", or "Mon 13 Oct". */
export function relativeDayLabel(date: string, today: string = localToday()): string {
  if (date === today) return 'Today'
  const [y, m, d] = date.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  const diff = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86400000)
  if (diff === 1) return 'Yesterday'
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}
