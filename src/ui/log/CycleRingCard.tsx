/**
 * CycleRingCard — the cycle ring, tappable, with paging through past cycles.
 *
 * Every lived day opens its log. Before any period has been logged there is no
 * cycle to draw, so the ring shows the last 28 days instead — still tappable,
 * so a new patient can backfill from day one.
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, daysBetween } from '../../engine/cycles'
import type { FeatureContext } from '../../engine/features'
import { BLEEDING_LEVELS, type Cycle } from '../../engine/types'
import { CycleRing, type RingDay } from '../charts'

interface Props {
  ctx: FeatureContext
  today: string
  /** Highlight this date (the day being viewed on /log/:date). */
  selectedDate?: string
  size?: number
}

function dayFor(ctx: FeatureContext, date: string, today: string, signed: number): RingDay {
  const day = ctx.daysByDate.get(date) ?? ctx.record.days.find((d) => d.date === date)
  return {
    date,
    bleedLevel: day?.bleeding ? BLEEDING_LEVELS.indexOf(day.bleeding) : 0,
    logged: Boolean(day?.logged),
    isToday: date === today,
    signedCycleDay: signed,
    future: date > today,
  }
}

export function CycleRingCard({ ctx, today, selectedDate, size = 236 }: Props) {
  const navigate = useNavigate()
  const cycles = ctx.cycles

  const typicalLength = useMemo(() => {
    const complete = cycles.filter((c) => c.complete).map((c) => c.lengthDays)
    return complete.length ? Math.round(complete.reduce((s, v) => s + v, 0) / complete.length) : 28
  }, [cycles])

  // Which cycle to show. Paging pins a cycle by its start date; otherwise the ring
  // follows the cycle containing the selected date (or today). Storing a start date
  // rather than an index matters: an index captured before the first period was
  // logged stayed at -1 and the ring never showed the new cycle.
  const focusDate = selectedDate ?? today
  const [pinnedStart, setPinnedStart] = useState<string | null>(null)
  const index = useMemo(() => {
    if (cycles.length === 0) return -1
    if (pinnedStart) {
      const pinned = cycles.findIndex((c) => c.startDate === pinnedStart)
      if (pinned >= 0) return pinned
    }
    for (let i = cycles.length - 1; i >= 0; i--) if (cycles[i].startDate <= focusDate) return i
    return 0
  }, [cycles, pinnedStart, focusDate])
  const setIndex = (update: (i: number) => number) => {
    const next = cycles[update(index)]
    if (next) setPinnedStart(next.startDate)
  }
  const cycle: Cycle | undefined = index >= 0 ? cycles[index] : undefined
  const isCurrent = cycle !== undefined && index === cycles.length - 1

  const ringDays = useMemo<RingDay[]>(() => {
    if (!cycle) {
      // No period logged yet: show the last 28 days so they can still be filled in.
      return Array.from({ length: 28 }, (_, i) => {
        const date = addDays(today, i - 27)
        return dayFor(ctx, date, today, i)
      })
    }
    if (cycle.complete) {
      const L = cycle.lengthDays
      return Array.from({ length: L }, (_, i) =>
        dayFor(ctx, addDays(cycle.startDate, i), today, i > L / 2 ? i - L : i),
      )
    }
    // The running cycle: elapsed days so far, then the rest of a typical cycle as
    // empty track — not a prediction, just room on the ring.
    const elapsed = Math.max(1, daysBetween(cycle.startDate, today) + 1)
    const length = Math.max(elapsed, typicalLength)
    return Array.from({ length }, (_, i) => dayFor(ctx, addDays(cycle.startDate, i), today, i))
  }, [cycle, ctx, today, typicalLength])

  const todaySigned = isCurrent && cycle ? daysBetween(cycle.startDate, today) : null

  return (
    <div className="flex flex-col items-center">
      <CycleRing
        days={ringDays}
        size={size}
        selectedDate={selectedDate}
        onDayClick={(date) => navigate(`/log/${date}`)}
        centre={
          cycle ? (
            isCurrent && todaySigned !== null && todaySigned >= 0 ? (
              <>
                <div className="text-[11px] font-medium uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>
                  Cycle day
                </div>
                <div className="display tnum" style={{ fontSize: 46, lineHeight: 1.05 }}>{todaySigned + 1}</div>
                <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                  started {cycle.startDate.slice(5).split('-').reverse().join('/')}
                </div>
              </>
            ) : (
              <>
                <div className="text-[11px] font-medium uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>
                  Cycle {index + 1}
                </div>
                <div className="display tnum" style={{ fontSize: 34, lineHeight: 1.1 }}>
                  {cycle.complete ? `${cycle.lengthDays} days` : 'ongoing'}
                </div>
                <div className="text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                  from {cycle.startDate.slice(5).split('-').reverse().join('/')}
                </div>
              </>
            )
          ) : (
            <>
              <div className="text-[11px] font-medium uppercase tracking-widest" style={{ color: 'var(--ink-muted)' }}>
                Last 28 days
              </div>
              <div className="mt-1 max-w-[130px] text-[12.5px] leading-snug" style={{ color: 'var(--ink-secondary)' }}>
                Log the first day of your period to start your cycle ring
              </div>
            </>
          )
        }
      />

      {cycles.length > 1 && (
        <div className="mt-2 flex items-center gap-3">
          <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 36, padding: '0 14px' }}
            onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}
            aria-label="Previous cycle">
            ←
          </button>
          <span className="tnum text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
            {index + 1} / {cycles.length}
          </span>
          <button type="button" className="btn btn-ghost focus-ring" style={{ minHeight: 36, padding: '0 14px' }}
            onClick={() => setIndex((i) => Math.min(cycles.length - 1, i + 1))} disabled={index >= cycles.length - 1}
            aria-label="Next cycle">
            →
          </button>
        </div>
      )}
    </div>
  )
}
