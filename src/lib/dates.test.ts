import { describe, expect, it } from 'vitest'
import { isFutureDate, localDateString, relativeDayLabel } from './dates'

describe('local calendar date', () => {
  it('returns the IST date just after midnight, where toISOString returns yesterday', () => {
    // 00:30 IST on 15 Oct = 19:00 UTC on 14 Oct.
    const instant = new Date('2026-10-14T19:00:00Z')
    expect(instant.toISOString().slice(0, 10)).toBe('2026-10-14') // the bug
    expect(localDateString(instant, 'Asia/Kolkata')).toBe('2026-10-15') // the fix
  })

  it('returns the IST date late in the evening', () => {
    // 23:30 IST on 15 Oct = 18:00 UTC on 15 Oct.
    expect(localDateString(new Date('2026-10-15T18:00:00Z'), 'Asia/Kolkata')).toBe('2026-10-15')
  })

  it('handles the IST day boundary exactly', () => {
    // 05:29 IST and 05:31 IST on the same calendar day, either side of UTC midnight.
    expect(localDateString(new Date('2026-10-14T23:59:00Z'), 'Asia/Kolkata')).toBe('2026-10-15')
    expect(localDateString(new Date('2026-10-15T00:01:00Z'), 'Asia/Kolkata')).toBe('2026-10-15')
  })

  it('works in time zones behind UTC too', () => {
    expect(localDateString(new Date('2026-10-15T02:00:00Z'), 'America/New_York')).toBe('2026-10-14')
  })

  it('identifies future dates', () => {
    expect(isFutureDate('2026-10-16', '2026-10-15')).toBe(true)
    expect(isFutureDate('2026-10-15', '2026-10-15')).toBe(false)
    expect(isFutureDate('2026-01-01', '2026-10-15')).toBe(false)
  })

  it('labels dates relative to today', () => {
    expect(relativeDayLabel('2026-10-15', '2026-10-15')).toBe('Today')
    expect(relativeDayLabel('2026-10-14', '2026-10-15')).toBe('Yesterday')
    expect(relativeDayLabel('2026-10-12', '2026-10-15')).toBe('Mon 12 Oct')
  })
})
