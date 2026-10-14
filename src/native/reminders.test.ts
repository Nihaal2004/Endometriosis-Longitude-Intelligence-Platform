import { describe, expect, it } from 'vitest'
import { parseReminderTime, periodReminderDue, REMINDER_TEXT } from './reminders'
import type { DayRecord } from '../engine/types'

const day = (date: string, bleeding: DayRecord['bleeding']): DayRecord => ({ date, logged: true, bleeding, symptoms: {} })

describe('period-mode reminders', () => {
  it('are due while bleeding is being logged', () => {
    expect(periodReminderDue([day('2026-10-15', 'heavy')], '2026-10-15')).toBe(true)
    expect(periodReminderDue([day('2026-10-14', 'light')], '2026-10-15')).toBe(true)
  })

  it('stop once bleeding stops being logged — no prediction', () => {
    expect(periodReminderDue([day('2026-10-13', 'heavy')], '2026-10-15')).toBe(false)
    expect(periodReminderDue([day('2026-10-15', 'none')], '2026-10-15')).toBe(false)
  })

  it('treat spotting as not a period', () => {
    expect(periodReminderDue([day('2026-10-15', 'spotting')], '2026-10-15')).toBe(false)
  })
})

describe('reminder content', () => {
  it('never names a symptom or a period', () => {
    const text = `${REMINDER_TEXT.title} ${REMINDER_TEXT.body}`.toLowerCase()
    for (const word of ['period', 'pain', 'bleed', 'endometriosis', 'missed', 'sex']) {
      expect(text).not.toContain(word)
    }
  })

  it('parses the reminder time, defaulting to 8 pm', () => {
    expect(parseReminderTime('07:30')).toEqual([7, 30])
    expect(parseReminderTime('21:05:00')).toEqual([21, 5])
    expect(parseReminderTime(null)).toEqual([20, 0])
    expect(parseReminderTime('25:00')).toEqual([20, 0])
  })
})
