/**
 * charts.tsx — Hand-built SVG chart primitives.
 *
 * No chart library: the cycle ring and phase heatmap are bespoke forms, and rolling
 * them by hand keeps typography and colour consistent with the rest of the product
 * rather than fighting a library's defaults.
 *
 * Conventions held throughout, per the data-viz method:
 *   - Colour is assigned by job: sequential ramp for magnitude, diverging for
 *     signed values, the validated categorical slots (in fixed order, never cycled)
 *     for identity. Product coral means bleeding and is never a series colour.
 *   - Text wears ink tokens, never the series colour; a swatch beside it carries
 *     identity so nothing depends on colour alone.
 *   - Marks are thin, grid and axes recede, and every chart carries a hover layer.
 *   - Light-mode teal sits below 3:1 on cream, so charts using it ship direct
 *     labels and a table view.
 */

import { useId, useState, type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

export const SERIES = ['var(--viz-series-1)', 'var(--viz-series-2)', 'var(--viz-series-3)']

const SEQ_STEPS = [
  'var(--viz-seq-0)', 'var(--viz-seq-1)', 'var(--viz-seq-2)', 'var(--viz-seq-3)',
  'var(--viz-seq-4)', 'var(--viz-seq-5)', 'var(--viz-seq-6)', 'var(--viz-seq-7)',
]

/** Map a 0..1 magnitude onto the sequential ramp. */
export function seqColor(t: number): string {
  if (!Number.isFinite(t)) return 'var(--viz-grid)'
  const i = Math.max(0, Math.min(SEQ_STEPS.length - 1, Math.round(t * (SEQ_STEPS.length - 1))))
  return SEQ_STEPS[i]
}

/** Map a signed −1..1 value onto the diverging ramp; 0 lands on neutral gray. */
export function divColor(t: number): string {
  if (!Number.isFinite(t)) return 'var(--viz-div-mid)'
  if (t <= -0.5) return 'var(--viz-div-neg-2)'
  if (t <= -0.15) return 'var(--viz-div-neg-1)'
  if (t < 0.15) return 'var(--viz-div-mid)'
  if (t < 0.5) return 'var(--viz-div-pos-1)'
  return 'var(--viz-div-pos-2)'
}

interface TooltipState {
  x: number
  y: number
  content: ReactNode
}

export function Tooltip({ state }: { state: TooltipState | null }) {
  if (!state) return null
  return (
    <div
      role="tooltip"
      style={{
        position: 'absolute',
        left: state.x,
        top: state.y,
        transform: 'translate(-50%, -115%)',
        background: 'var(--surface-raised)',
        border: '1px solid var(--hairline-strong)',
        borderRadius: 10,
        padding: '8px 11px',
        fontSize: 12.5,
        lineHeight: 1.45,
        color: 'var(--ink)',
        boxShadow: '0 6px 20px rgba(46,27,46,0.16)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: 40,
      }}
    >
      {state.content}
    </div>
  )
}

export function Legend({
  items,
}: {
  items: { label: string; color: string; shape?: 'line' | 'square' }[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-2 text-[12.5px]"
          style={{ color: 'var(--ink-secondary)' }}>
          <span
            aria-hidden
            style={{
              width: it.shape === 'square' ? 11 : 16,
              height: it.shape === 'square' ? 11 : 3,
              borderRadius: it.shape === 'square' ? 3 : 2,
              background: it.color,
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          {it.label}
        </span>
      ))}
    </div>
  )
}

/** Disclosure wrapper that makes the underlying numbers reachable as a table. */
export function TableView({ children, label = 'View as table' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="focus-ring rounded text-[12.5px] underline underline-offset-2"
        style={{ color: 'var(--ink-muted)', background: 'none', border: 'none', padding: '2px 0' }}
      >
        {open ? 'Hide table' : label}
      </button>
      {open && <div className="mt-2 overflow-x-auto">{children}</div>}
    </div>
  )
}

export function DataTable({
  head,
  rows,
}: {
  head: string[]
  rows: (string | number)[][]
}) {
  return (
    <table className="w-full text-[12.5px] tnum" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {head.map((h) => (
            <th
              key={h}
              className="px-2 py-1.5 text-left font-medium"
              style={{ color: 'var(--ink-muted)', borderBottom: '1px solid var(--hairline)' }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td
                key={j}
                className="px-2 py-1.5"
                style={{ color: 'var(--ink-secondary)', borderBottom: '1px solid var(--hairline)' }}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Cycle ring — the signature home-screen form
// ---------------------------------------------------------------------------

export interface RingDay {
  date: string
  /** 0 = none … 5 = very heavy. */
  bleedLevel: number
  logged: boolean
  isToday: boolean
  signedCycleDay: number
  /** A day in the current cycle that has not happened yet. Drawn as empty track. */
  future?: boolean
}

/**
 * A single cycle drawn as a ring: one segment per day, coral arc for bleeding,
 * hollow segments for unlogged days.
 *
 * Unlogged days are drawn as an *outline* rather than a fill, so a gap in the record
 * looks like a gap. This is the visual counterpart of the tri-state rule — a consumer
 * tracker's empty cell reads as "nothing happened", and that is exactly the
 * misreading the whole system is built to avoid.
 */
export function CycleRing({
  days,
  size = 240,
  centre,
}: {
  days: RingDay[]
  size?: number
  centre?: ReactNode
}) {
  const [hover, setHover] = useState<TooltipState | null>(null)
  const stroke = 16
  const r = (size - stroke - 14) / 2
  const cx = size / 2
  const cy = size / 2
  const n = Math.max(days.length, 1)
  const gap = 0.7 // degrees of surface showing between segments

  const arc = (i: number) => {
    const a0 = (i / n) * 360 - 90 + gap / 2
    const a1 = ((i + 1) / n) * 360 - 90 - gap / 2
    const p = (deg: number) => {
      const rad = (deg * Math.PI) / 180
      return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
    }
    const [x0, y0] = p(a0)
    const [x1, y1] = p(a1)
    const large = a1 - a0 > 180 ? 1 : 0
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`
  }

  const bleedColor = (level: number) => {
    if (level <= 0) return 'var(--viz-grid)'
    const t = level / 5
    return `color-mix(in srgb, var(--bleed) ${30 + t * 70}%, var(--surface))`
  }

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} role="img"
        aria-label={`Cycle ring covering ${days.length} days`}>
        {days.map((d, i) => (
          <path
            key={d.date}
            d={arc(i)}
            fill="none"
            stroke={d.logged ? bleedColor(d.bleedLevel) : 'transparent'}
            strokeWidth={stroke}
            strokeLinecap="butt"
            style={{
              // Three distinct states, deliberately drawn differently:
              //   logged        — solid, coral in proportion to flow
              //   not logged    — faint dashed trace (a gap must look like a gap)
              //   not yet lived — plain thin track, no data claim of any kind
              ...(d.future
                ? { stroke: 'var(--viz-grid)', strokeWidth: 4 }
                : d.logged
                  ? {}
                  : { stroke: 'var(--hairline-strong)', strokeDasharray: '1.5 3', strokeWidth: 2 }),
              cursor: d.future ? 'default' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (d.future) return
              const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
              setHover({
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
                content: (
                  <>
                    <strong>{d.date}</strong>
                    <br />
                    {d.logged
                      ? `Cycle day ${d.signedCycleDay >= 0 ? `D+${d.signedCycleDay}` : `D${d.signedCycleDay}`} · ${
                          ['no bleeding', 'spotting', 'light', 'moderate', 'heavy', 'very heavy'][d.bleedLevel]
                        }`
                      : 'No entry — unknown'}
                  </>
                ),
              })
            }}
            onMouseLeave={() => setHover(null)}
          />
        ))}

        {/* Today marker */}
        {days.map((d, i) => {
          if (!d.isToday) return null
          const mid = ((i + 0.5) / n) * 360 - 90
          const rad = (mid * Math.PI) / 180
          const rr = r + stroke / 2 + 6
          return (
            <circle
              key="today"
              cx={cx + rr * Math.cos(rad)}
              cy={cy + rr * Math.sin(rad)}
              r={3.5}
              fill="var(--ink)"
            />
          )
        })}
      </svg>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          textAlign: 'center',
        }}
      >
        {centre}
      </div>

      <Tooltip state={hover} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cycle-phase heatmap
// ---------------------------------------------------------------------------

export interface PhaseCell {
  /** Signed cycle day, e.g. −4 … +7 */
  day: number
  rate: number
  present: number
  observed: number
}

export interface PhaseRow {
  label: string
  cells: PhaseCell[]
}

/**
 * Symptom × cycle-day occurrence rate.
 *
 * Sequential ramp, one hue, light to dark. Cells with no observations are drawn as an
 * explicit hatch rather than as the ramp's lightest step, because "never happened"
 * and "never asked" must not look the same — the lightest step means a real zero.
 */
export function PhaseHeatmap({
  rows,
  dayRange,
}: {
  rows: PhaseRow[]
  dayRange: number[]
}) {
  const [hover, setHover] = useState<TooltipState | null>(null)
  const hatchId = useId()
  const cell = 26
  const gapPx = 2
  const labelW = 132
  const headerH = 26

  const width = labelW + dayRange.length * cell
  const height = headerH + rows.length * cell

  return (
    <div style={{ position: 'relative', overflowX: 'auto' }}>
      <svg width={width} height={height} role="img" aria-label="Symptom occurrence rate by cycle day">
        <defs>
          <pattern id={hatchId} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="var(--viz-surface)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--viz-axis)" strokeWidth="1.5" />
          </pattern>
        </defs>

        {/* Column headers */}
        {dayRange.map((d, i) => (
          <text
            key={d}
            x={labelW + i * cell + cell / 2}
            y={headerH - 9}
            textAnchor="middle"
            fontSize={10.5}
            className="tnum"
            fill={d === 0 ? 'var(--viz-ink)' : 'var(--viz-ink-muted)'}
            fontWeight={d === 0 ? 600 : 400}
          >
            {d === 0 ? 'D0' : d > 0 ? `+${d}` : d}
          </text>
        ))}

        {/* Onset rule */}
        {dayRange.includes(0) && (
          <line
            x1={labelW + dayRange.indexOf(0) * cell - 1}
            y1={headerH - 4}
            x2={labelW + dayRange.indexOf(0) * cell - 1}
            y2={height}
            stroke="var(--bleed)"
            strokeWidth={1.5}
            opacity={0.5}
          />
        )}

        {rows.map((row, ri) => (
          <g key={row.label}>
            <text
              x={labelW - 12}
              y={headerH + ri * cell + cell / 2 + 4}
              textAnchor="end"
              fontSize={12}
              fill="var(--viz-ink-secondary)"
            >
              {row.label.length > 18 ? `${row.label.slice(0, 17)}…` : row.label}
            </text>

            {dayRange.map((d, ci) => {
              const c = row.cells.find((x) => x.day === d)
              const hasData = c !== undefined && c.observed > 0
              return (
                <rect
                  key={d}
                  x={labelW + ci * cell + gapPx / 2}
                  y={headerH + ri * cell + gapPx / 2}
                  width={cell - gapPx}
                  height={cell - gapPx}
                  rx={4}
                  fill={hasData ? seqColor(c.rate) : `url(#${hatchId})`}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => {
                    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                    setHover({
                      x: e.clientX - rect.left,
                      y: e.clientY - rect.top,
                      content: hasData ? (
                        <>
                          <strong>{row.label}</strong> · day {d === 0 ? 'D0' : d > 0 ? `+${d}` : d}
                          <br />
                          {c.present} of {c.observed} observed days ({Math.round(c.rate * 100)}%)
                        </>
                      ) : (
                        <>
                          <strong>{row.label}</strong> · day {d === 0 ? 'D0' : d > 0 ? `+${d}` : d}
                          <br />
                          No observations — unknown
                        </>
                      ),
                    })
                  }}
                  onMouseLeave={() => setHover(null)}
                />
              )
            })}
          </g>
        ))}
      </svg>
      <Tooltip state={hover} />
    </div>
  )
}

export function SequentialLegend({ max }: { max: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>0%</span>
      <div className="flex" style={{ gap: 2 }}>
        {SEQ_STEPS.map((c) => (
          <span key={c} style={{ width: 20, height: 10, borderRadius: 2, background: c }} />
        ))}
      </div>
      <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>{Math.round(max * 100)}%</span>
      <span className="ml-2 inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
        <span
          style={{
            width: 10, height: 10, borderRadius: 2,
            backgroundImage: 'repeating-linear-gradient(45deg, var(--viz-axis) 0 1.5px, transparent 1.5px 4px)',
            border: '1px solid var(--hairline-strong)',
          }}
        />
        not observed
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sparkline — per-cycle rates
// ---------------------------------------------------------------------------

export function Sparkline({
  values,
  width = 132,
  height = 34,
  color = 'var(--viz-series-1)',
  labels,
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
  labels?: string[]
}) {
  const [hover, setHover] = useState<TooltipState | null>(null)
  if (values.length < 2) {
    return <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>not enough cycles</span>
  }

  const pad = 5
  const max = Math.max(...values, 0.0001)
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2)
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2)
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ')

  return (
    <div style={{ position: 'relative', width, height }}>
      <svg width={width} height={height} role="img" aria-label="Rate per cycle">
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {values.map((v, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(v)}
            r={i === values.length - 1 ? 4 : 3}
            fill={color}
            stroke="var(--surface)"
            strokeWidth={2}
            style={{ cursor: 'pointer' }}
            onMouseEnter={(e) => {
              const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
              setHover({
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
                content: `${labels?.[i] ?? `Cycle ${i + 1}`}: ${Math.round(v * 100)}%`,
              })
            }}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      <Tooltip state={hover} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Co-occurrence matrix — signed, so diverging
// ---------------------------------------------------------------------------

export function CoOccurrenceMatrix({
  labels,
  values,
}: {
  labels: string[]
  /** values[i][j] = kappa, NaN where not computed. */
  values: number[][]
}) {
  const [hover, setHover] = useState<TooltipState | null>(null)
  const cell = 40
  const labelW = 124
  const headerH = 76
  const width = labelW + labels.length * cell
  const height = headerH + labels.length * cell

  return (
    <div style={{ position: 'relative', overflowX: 'auto' }}>
      <svg width={width} height={height} role="img" aria-label="Symptom co-occurrence, Cohen's kappa">
        {labels.map((l, i) => (
          <text
            key={`h${l}`}
            transform={`translate(${labelW + i * cell + cell / 2}, ${headerH - 10}) rotate(-45)`}
            fontSize={11}
            fill="var(--viz-ink-muted)"
          >
            {l.length > 13 ? `${l.slice(0, 12)}…` : l}
          </text>
        ))}

        {labels.map((rowLabel, ri) => (
          <g key={rowLabel}>
            <text
              x={labelW - 10}
              y={headerH + ri * cell + cell / 2 + 4}
              textAnchor="end"
              fontSize={11.5}
              fill="var(--viz-ink-secondary)"
            >
              {rowLabel.length > 15 ? `${rowLabel.slice(0, 14)}…` : rowLabel}
            </text>
            {labels.map((colLabel, ci) => {
              const v = values[ri]?.[ci]
              const diagonal = ri === ci
              const known = Number.isFinite(v) && !diagonal
              return (
                <g key={colLabel}>
                  <rect
                    x={labelW + ci * cell + 1}
                    y={headerH + ri * cell + 1}
                    width={cell - 2}
                    height={cell - 2}
                    rx={5}
                    fill={diagonal ? 'var(--viz-grid)' : known ? divColor(v) : 'var(--viz-surface)'}
                    stroke={known ? 'none' : 'var(--hairline)'}
                    style={{ cursor: known ? 'pointer' : 'default' }}
                    onMouseEnter={(e) => {
                      if (!known) return
                      const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                      setHover({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top,
                        content: (
                          <>
                            <strong>{rowLabel}</strong> × {colLabel}
                            <br />
                            Cohen&apos;s κ = {v.toFixed(2)}
                          </>
                        ),
                      })
                    }}
                    onMouseLeave={() => setHover(null)}
                  />
                  {/* Direct label on every cell the ramp has tinted, so a coloured
                      cell always carries its number and colour is never the only cue. */}
                  {known && Math.abs(v) >= 0.15 && (
                    // Direct label: the value never depends on reading the colour.
                    <text
                      x={labelW + ci * cell + cell / 2}
                      y={headerH + ri * cell + cell / 2 + 4}
                      textAnchor="middle"
                      fontSize={10.5}
                      className="tnum"
                      fill={Math.abs(v) >= 0.5 ? 'var(--surface)' : 'var(--viz-ink)'}
                      style={{ pointerEvents: 'none' }}
                    >
                      {v.toFixed(2)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        ))}
      </svg>
      <Tooltip state={hover} />
    </div>
  )
}

export function DivergingLegend() {
  return (
    <div className="flex items-center gap-3 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
      <span>κ −1</span>
      <div className="flex" style={{ gap: 2 }}>
        {['var(--viz-div-neg-2)', 'var(--viz-div-neg-1)', 'var(--viz-div-mid)', 'var(--viz-div-pos-1)', 'var(--viz-div-pos-2)'].map((c) => (
          <span key={c} style={{ width: 22, height: 10, borderRadius: 2, background: c }} />
        ))}
      </div>
      <span>+1</span>
      <span className="ml-1">0 = chance agreement</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Line sweep — metric vs parameter
// ---------------------------------------------------------------------------

export interface SweepSeries {
  label: string
  color: string
  points: { x: number; y: number }[]
}

export function LineSweep({
  series,
  width = 460,
  height = 220,
  xLabel,
  yLabel,
  xTicks,
  formatX = (x: number) => String(x),
}: {
  series: SweepSeries[]
  width?: number
  height?: number
  xLabel: string
  yLabel: string
  xTicks?: number[]
  formatX?: (x: number) => string
}) {
  const [hover, setHover] = useState<TooltipState | null>(null)
  const padL = 44
  const padR = 16
  const padT = 14
  const padB = 40

  const allX = series.flatMap((s) => s.points.map((p) => p.x))
  const xMin = Math.min(...allX)
  const xMax = Math.max(...allX)

  const sx = (x: number) => padL + ((x - xMin) / (xMax - xMin || 1)) * (width - padL - padR)
  const sy = (y: number) => padT + (1 - y) * (height - padT - padB)

  // Thin the tick set so labels cannot collide. The x values are often bunched — the
  // concentration sweep crowds toward 1 — so ticks are chosen by pixel distance, not
  // by taking every nth value. Greedy left to right, with the last value always kept.
  const uniqueX = allX.filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b)
  const MIN_TICK_GAP_PX = 48

  function thinTicks(values: number[]): number[] {
    if (values.length <= 2) return values
    const last = values[values.length - 1]
    const kept: number[] = []
    for (const v of values.slice(0, -1)) {
      const prev = kept[kept.length - 1]
      if (prev === undefined || Math.abs(sx(v) - sx(prev)) >= MIN_TICK_GAP_PX) kept.push(v)
    }
    // Drop a kept tick that would collide with the final one, then append it.
    while (kept.length > 0 && Math.abs(sx(last) - sx(kept[kept.length - 1])) < MIN_TICK_GAP_PX) {
      kept.pop()
    }
    kept.push(last)
    return kept
  }

  const ticks = xTicks ?? thinTicks(uniqueX)
  const yTicks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div style={{ position: 'relative', width, maxWidth: '100%' }}>
      <svg width={width} height={height} role="img" aria-label={`${yLabel} versus ${xLabel}`}
        style={{ maxWidth: '100%' }}>
        {/* Recessive grid */}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={padL} y1={sy(t)} x2={width - padR} y2={sy(t)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={padL - 9} y={sy(t) + 4} textAnchor="end" fontSize={10.5} className="tnum" fill="var(--viz-ink-muted)">
              {t.toFixed(2)}
            </text>
          </g>
        ))}

        {ticks.map((t) => (
          <text key={t} x={sx(t)} y={height - padB + 17} textAnchor="middle" fontSize={10.5}
            className="tnum" fill="var(--viz-ink-muted)">
            {formatX(t)}
          </text>
        ))}

        <text x={(padL + width - padR) / 2} y={height - 6} textAnchor="middle" fontSize={11.5} fill="var(--viz-ink-secondary)">
          {xLabel}
        </text>
        <text transform={`translate(11, ${(padT + height - padB) / 2}) rotate(-90)`} textAnchor="middle"
          fontSize={11.5} fill="var(--viz-ink-secondary)">
          {yLabel}
        </text>

        {series.map((s) => {
          const pts = [...s.points].sort((a, b) => a.x - b.x)
          const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x)} ${sy(p.y)}`).join(' ')
          return (
            <g key={s.label}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              {pts.map((p) => (
                <circle
                  key={p.x}
                  cx={sx(p.x)}
                  cy={sy(p.y)}
                  r={4.5}
                  fill={s.color}
                  stroke="var(--viz-surface)"
                  strokeWidth={2}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => {
                    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                    setHover({
                      x: e.clientX - rect.left,
                      y: e.clientY - rect.top,
                      content: (
                        <>
                          <strong>{s.label}</strong>
                          <br />
                          {xLabel} {formatX(p.x)} → {p.y.toFixed(3)}
                        </>
                      ),
                    })
                  }}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
            </g>
          )
        })}
      </svg>
      <Tooltip state={hover} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Confusion matrix
// ---------------------------------------------------------------------------

export function ConfusionMatrix({
  tp, fp, tn, fn,
}: {
  tp: number
  fp: number
  tn: number
  fn: number
}) {
  const total = tp + fp + tn + fn || 1
  const cells = [
    { label: 'True positive', sub: 'cyclical, reported', value: tp, correct: true },
    { label: 'False negative', sub: 'cyclical, withheld', value: fn, correct: false },
    { label: 'False positive', sub: 'not cyclical, reported', value: fp, correct: false },
    { label: 'True negative', sub: 'not cyclical, withheld', value: tn, correct: true },
  ]

  return (
    <div className="grid grid-cols-2" style={{ gap: 2, maxWidth: 400 }}>
      {cells.map((c) => (
        <div
          key={c.label}
          className="rounded-xl p-4"
          style={{
            background: c.correct
              ? `color-mix(in srgb, var(--viz-seq-4) ${18 + (c.value / total) * 60}%, var(--surface))`
              : `color-mix(in srgb, var(--viz-critical) ${10 + (c.value / total) * 55}%, var(--surface))`,
            border: '1px solid var(--hairline)',
          }}
        >
          <div className="display tnum" style={{ fontSize: 30, lineHeight: 1.05, color: 'var(--ink)' }}>
            {c.value}
          </div>
          <div className="mt-1 text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>{c.label}</div>
          <div className="text-[11.5px]" style={{ color: 'var(--ink-secondary)' }}>{c.sub}</div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Burden ribbon — daily symptom load over the timeline
// ---------------------------------------------------------------------------

export function BurdenRibbon({
  days,
  height = 64,
  bands = [],
}: {
  days: { date: string; burden: number | null; bleeding: number }[]
  height?: number
  bands?: { startDate: string; endDate?: string; label: string; kind: 'treatment' | 'event' }[]
}) {
  const [hover, setHover] = useState<TooltipState | null>(null)
  const w = 3
  const gap = 1
  const width = days.length * (w + gap)
  const max = Math.max(1, ...days.map((d) => d.burden ?? 0))
  const indexOfDate = (d: string) => days.findIndex((x) => x.date >= d)

  return (
    <div style={{ position: 'relative', overflowX: 'auto' }}>
      <svg width={width} height={height + 20} role="img" aria-label="Daily symptom burden">
        {bands.map((b, i) => {
          const a = indexOfDate(b.startDate)
          if (a < 0) return null
          const bEnd = b.endDate ? indexOfDate(b.endDate) : days.length - 1
          const x0 = a * (w + gap)
          const x1 = (bEnd < 0 ? days.length - 1 : bEnd) * (w + gap)
          if (b.kind === 'treatment') {
            return (
              <rect key={i} x={x0} y={0} width={Math.max(2, x1 - x0)} height={height}
                fill="var(--violet-soft)" opacity={0.85} rx={3} />
            )
          }
          return <line key={i} x1={x0} y1={0} x2={x0} y2={height} stroke="var(--amber)" strokeWidth={1.5} opacity={0.75} />
        })}

        {days.map((d, i) => {
          const x = i * (w + gap)
          if (d.burden === null) {
            return <rect key={d.date} x={x} y={height - 3} width={w} height={3} rx={1.5} fill="var(--hairline-strong)" />
          }
          const h = Math.max(3, (d.burden / max) * height)
          return (
            <rect
              key={d.date}
              x={x}
              y={height - h}
              width={w}
              height={h}
              rx={1.5}
              fill={d.bleeding > 0 ? 'var(--bleed)' : 'var(--viz-seq-5)'}
              style={{ cursor: 'pointer' }}
              onMouseEnter={(e) => {
                const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                setHover({
                  x: e.clientX - rect.left,
                  y: e.clientY - rect.top,
                  content: (
                    <>
                      <strong>{d.date}</strong>
                      <br />
                      burden {d.burden}
                      {d.bleeding > 0 ? ' · bleeding' : ''}
                    </>
                  ),
                })
              }}
              onMouseLeave={() => setHover(null)}
            />
          )
        })}
      </svg>
      <Tooltip state={hover} />
    </div>
  )
}
