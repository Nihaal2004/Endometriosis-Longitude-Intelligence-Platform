/**
 * DayLog — /log/:date. Any past day: view it, change it, fill it in, or clear it.
 */

import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { addDays } from '../../engine/cycles'
import { isFutureDate, relativeDayLabel } from '../../lib/dates'
import { useAnalysis, useData } from '../data'
import { CycleRingCard } from '../log/CycleRingCard'
import { DayLogForm } from '../log/DayLogForm'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export default function DayLog() {
  const { date = '' } = useParams()
  const { today, record } = useData()
  const { ctx } = useAnalysis()
  const navigate = useNavigate()

  if (!ISO_DATE.test(date)) return <Navigate to="/today" replace />
  if (date === today) return <Navigate to="/today" replace />

  const prev = addDays(date, -1)
  const next = addDays(date, 1)
  const logged = record.days.some((d) => d.date === date)
  const long = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })

  return (
    <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      <section className="card hidden p-5 lg:block">
        <CycleRingCard ctx={ctx} today={today} selectedDate={date} />
      </section>

      <section className="card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 38, padding: '0 14px' }}
            onClick={() => navigate(`/log/${prev}`)} aria-label="Previous day">
            ←
          </button>
          <div className="text-center">
            <h1 style={{ fontSize: 22 }}>{relativeDayLabel(date, today)}</h1>
            <p className="text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
              {long} · {logged ? 'logged' : 'no entry yet'}
            </p>
          </div>
          <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 38, padding: '0 14px' }}
            onClick={() => navigate(next === today ? '/today' : `/log/${next}`)}
            disabled={isFutureDate(next, today)} aria-label="Next day">
            →
          </button>
        </div>

        <div className="mt-6">
          <DayLogForm key={date} date={date} ctx={ctx} onCleared={() => navigate('/today')} />
        </div>

        <p className="mt-8 text-center text-[13.5px]">
          <Link to="/today" className="link">Back to today</Link>
          <span className="mx-2" style={{ color: 'var(--ink-muted)' }}>·</span>
          <Link to="/calendar" className="link">Calendar</Link>
        </p>
      </section>
    </div>
  )
}
