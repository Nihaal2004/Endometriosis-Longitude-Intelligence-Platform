/**
 * Calendar — the month at a glance, and the natural place to fix past entries.
 *
 * Three day states, drawn distinctly: bleeding (coral, by flow), logged (a small
 * ink dot), and not logged (nothing). Tap any past day to open its log.
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays } from '../../engine/cycles'
import { BLEEDING_LEVELS } from '../../engine/types'
import { useData } from '../data'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function monthKey(date: string) {
  return date.slice(0, 7)
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export default function Calendar() {
  const { today, record } = useData()
  const navigate = useNavigate()
  const [month, setMonth] = useState(monthKey(today))

  const byDate = useMemo(() => new Map(record.days.map((d) => [d.date, d])), [record.days])

  const cells = useMemo(() => {
    const first = `${month}-01`
    const [y, m] = month.split('-').map(Number)
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
    // Monday-first grid offset.
    const weekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
    const out: (string | null)[] = Array.from({ length: weekday }, () => null)
    for (let i = 0; i < daysInMonth; i++) out.push(addDays(first, i))
    while (out.length % 7 !== 0) out.push(null)
    return out
  }, [month])

  const logged = cells.filter((c) => c && byDate.has(c)).length
  const lived = cells.filter((c) => c && c <= today).length
  const title = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })

  return (
    <section className="card mx-auto max-w-xl p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 38, padding: '0 14px' }}
          onClick={() => setMonth((k) => shiftMonth(k, -1))} aria-label="Previous month">
          ←
        </button>
        <div className="text-center">
          <h1 style={{ fontSize: 22 }}>{title}</h1>
          <p className="tnum text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
            {logged} of {lived} days logged
          </p>
        </div>
        <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 38, padding: '0 14px' }}
          onClick={() => setMonth((k) => shiftMonth(k, 1))} disabled={month >= monthKey(today)}
          aria-label="Next month">
          →
        </button>
      </div>

      <div className="mt-5 grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
            {w}
          </div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`pad-${i}`} />
          const day = byDate.get(date)
          const future = date > today
          const bleed = day?.bleeding ? BLEEDING_LEVELS.indexOf(day.bleeding) : 0
          const isToday = date === today
          return (
            <button
              key={date}
              type="button"
              disabled={future}
              onClick={() => navigate(isToday ? '/today' : `/log/${date}`)}
              className="focus-ring relative flex aspect-square flex-col items-center justify-center rounded-xl text-[14px] tnum"
              style={{
                background: bleed > 0 ? `color-mix(in srgb, var(--bleed) ${18 + bleed * 14}%, var(--surface))` : 'transparent',
                color: future ? 'var(--hairline-strong)' : 'var(--ink)',
                border: isToday ? '2px solid var(--ink)' : '1px solid transparent',
                cursor: future ? 'default' : 'pointer',
                fontWeight: isToday ? 700 : 500,
              }}
              aria-label={`${date}${day ? ', logged' : future ? '' : ', no entry'}${bleed > 1 ? ', bleeding' : ''}`}
            >
              {Number(date.slice(8))}
              <span
                aria-hidden
                className="absolute bottom-1.5"
                style={{
                  width: 4, height: 4, borderRadius: 999,
                  background: day ? 'var(--ink)' : 'transparent',
                }}
              />
            </button>
          )
        })}
      </div>

      <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden style={{ width: 12, height: 12, borderRadius: 4, background: 'color-mix(in srgb, var(--bleed) 60%, var(--surface))' }} />
          Bleeding
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--ink)' }} />
          Logged
        </span>
        <span>No dot = no entry</span>
      </div>
    </section>
  )
}
