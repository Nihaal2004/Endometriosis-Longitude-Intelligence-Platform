/**
 * Today — the 20-second screen.
 *
 * The cycle ring and today's check-in, and nothing else that competes with them.
 * Explanations sit behind ⓘ. Days without an entry this week are offered back,
 * without guilt, because coverage is what lets the report say anything at all.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { explainDormancy, planDailyQuestions } from '../../engine/adaptive'
import { addDays } from '../../engine/cycles'
import { relativeDayLabel } from '../../lib/dates'
import { useAnalysis, useData } from '../data'
import { CycleRingCard } from '../log/CycleRingCard'
import { DayLogForm } from '../log/DayLogForm'

export default function Today() {
  const { today, record } = useData()
  const { ctx } = useAnalysis()
  const [info, setInfo] = useState(false)

  // Days this past week with no entry — but never before the first entry, so a
  // new patient isn't nudged about days before she started.
  const gaps = useMemo(() => {
    const first = record.days[0]?.date
    if (!first) return []
    const logged = new Set(record.days.map((d) => d.date))
    const out: string[] = []
    for (let i = 1; i <= 7; i++) {
      const d = addDays(today, -i)
      if (d < first) break
      if (!logged.has(d)) out.push(d)
    }
    return out
  }, [record.days, today])

  const plan = useMemo(() => planDailyQuestions(ctx, today), [ctx, today])
  const loggedToday = record.days.some((d) => d.date === today)

  return (
    <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      <section className="card relative p-5">
        <button
          type="button"
          onClick={() => setInfo((v) => !v)}
          className="focus-ring absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold"
          style={{ border: '1px solid var(--hairline-strong)', background: 'var(--surface)', color: 'var(--ink-muted)' }}
          aria-expanded={info}
          aria-label="About the ring"
        >
          i
        </button>
        <CycleRingCard ctx={ctx} today={today} />
        <p className="mt-3 text-center text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          Tap any day to see or change it
        </p>

        {info && (
          <div className="mt-4 space-y-2 rounded-xl p-3 text-[12.5px] leading-relaxed"
            style={{ background: 'var(--surface-sunken)', color: 'var(--ink-secondary)' }}>
            <p>Coloured segments are bleeding days. Dashes are days with no entry — they stay <em>unknown</em> and are never counted as symptom-free.</p>
            <p>The pale track is the rest of a typical cycle. It isn’t a prediction of your next period.</p>
            <p className="tnum">
              {record.days.length} {record.days.length === 1 ? 'day' : 'days'} logged so far.
            </p>
            {plan.dormant.length > 0 && (
              <div>
                <p className="font-semibold" style={{ color: 'var(--ink)' }}>Not asked today</p>
                <ul className="mt-1 space-y-1">
                  {plan.dormant.slice(0, 4).map((d) => <li key={d.symptomId}>{explainDormancy(d)}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <h1 style={{ fontSize: 26 }}>Today</h1>
          {loggedToday && (
            <span className="text-[12.5px]" style={{ color: 'var(--sage)' }}>Logged — change anything below</span>
          )}
        </div>

        {gaps.length > 0 && (
          <div className="mb-6 rounded-xl p-3.5" style={{ background: 'var(--surface-sunken)' }}>
            <p className="text-[13.5px]" style={{ color: 'var(--ink-secondary)' }}>
              {gaps.length === 1 ? '1 day' : `${gaps.length} days`} this week {gaps.length === 1 ? 'has' : 'have'} no entry. Add {gaps.length === 1 ? 'it' : 'them'} if you remember how {gaps.length === 1 ? 'it' : 'they'} went:
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {gaps.map((d) => (
                <Link key={d} to={`/log/${d}`} className="chip focus-ring" style={{ minHeight: 36, fontSize: 13, textDecoration: 'none' }}>
                  {relativeDayLabel(d, today)}
                </Link>
              ))}
            </div>
          </div>
        )}

        <DayLogForm key={today} date={today} ctx={ctx} />
      </section>
    </div>
  )
}
