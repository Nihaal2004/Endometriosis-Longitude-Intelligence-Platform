/**
 * brief.ts — Deterministic natural-language generation for the clinician brief.
 *
 * THE CENTRAL RULE OF THIS FILE
 *
 *   No number in the brief is ever authored by a language model.
 *
 * Every sentence is rendered from a template whose numeric slots are filled from a
 * `Finding` produced by the pattern engine. The rendered sentence and the numbers it
 * contains are emitted together as a `Claim`, and `assertedValues` records exactly
 * which numbers appear in the prose so that fidelity.ts can independently re-derive
 * each one from the raw day records and reject the claim on any mismatch.
 *
 * If the optional LLM polish path is enabled, it may only rephrase; the polished
 * sentence is put through a numeric-token check against the same `assertedValues`
 * before it is allowed to render.
 *
 * REGISTER
 *
 * Sentences are descriptive, never diagnostic. They say what was recorded and over
 * what denominator. They never say "suggests endometriosis", never stage disease, and
 * never assign a risk score. Where a causal reading is tempting — treatment response
 * above all — the sentence states its own limitation inline.
 */

import { summariseCycles } from './cycles'
import { AREA_KEY_PREFIX, summariseImpact, summariseMedication, type FeatureContext } from './features'
import { clinicalLabel } from './symptoms'
import type { BriefSection, Claim, ConsultationBrief, Finding, PatternKind } from './types'

// ---------------------------------------------------------------------------
// Formatting helpers — the single source of truth for how a number is rendered
// ---------------------------------------------------------------------------

export function pct(x: number): number {
  return Math.round(x * 100)
}

export function round(x: number, dp = 1): number {
  const f = 10 ** dp
  return Math.round(x * f) / f
}

/** p-values are reported at a sensible precision, with a floor rather than "p = 0". */
export function formatP(p: number): string {
  if (p < 0.001) return 'p < 0.001'
  if (p < 0.01) return `p = ${p.toFixed(3)}`
  return `p = ${p.toFixed(2)}`
}

export function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  return `${d} ${months[m - 1]} ${y}`
}

// ---------------------------------------------------------------------------
// Finding selection
// ---------------------------------------------------------------------------

/**
 * Rank findings by clinical salience so the brief stays short.
 *
 * The consultation-brief literature is unambiguous that patient-generated data can
 * *increase* clinician workload if it is long or poorly prioritised, so a brief that
 * reports every significant finding would defeat its own purpose. Ranking is by
 * pattern class first (a cyclicity finding is the single most useful thing a
 * gynaecologist can be handed), then by effect size within class.
 */
const KIND_PRIORITY: Record<PatternKind, number> = {
  cyclicity: 0,
  baseline_change: 1,
  treatment_response: 2,
  trend: 3,
  functional_burden: 4,
  persistence: 5,
  co_occurrence: 6,
}

export function rankFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const byKind = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]
    if (byKind !== 0) return byKind
    const effectA = Math.abs(a.effect?.value ?? 0)
    const effectB = Math.abs(b.effect?.value ?? 0)
    if (effectB !== effectA) return effectB - effectA
    return (a.test?.q ?? a.test?.p ?? 1) - (b.test?.q ?? b.test?.p ?? 1)
  })
}

export interface BriefConfig {
  /** Maximum longitudinal findings reported. Keeps the brief to roughly one page. */
  maxFindings: number
  /** Persistence is only worth a sentence above this non-menstrual rate. */
  persistenceFloor: number
  /** Co-occurrence is only worth a sentence above this kappa. */
  kappaFloor: number
  customLabels?: Record<string, string>
}

export const DEFAULT_BRIEF_CONFIG: BriefConfig = {
  maxFindings: 6,
  // 0.20 is a reporting threshold, not a clinical one: below roughly one day in five,
  // "also occurs outside menstruation" is not a pattern a clinician can act on.
  persistenceFloor: 0.2,
  // 0.21 is the conventional lower bound of "fair" agreement on the Landis-Koch
  // scale; below it, kappa describes essentially chance co-occurrence.
  kappaFloor: 0.21,
}

// ---------------------------------------------------------------------------
// Claim rendering
// ---------------------------------------------------------------------------

function claim(
  findingId: string,
  section: BriefSection,
  text: string,
  assertedValues: Record<string, number>,
  evidenceDates: string[],
  suffix = '',
): Claim {
  return {
    id: `${findingId}${suffix}`,
    findingId,
    section,
    text,
    assertedValues,
    evidenceDates,
  }
}

function renderCyclicity(f: Finding, label: string): Claim {
  const v = f.values
  const mwPct = pct(v.menstrualRate)
  const nonPct = pct(v.nonMenstrualRate)
  const rr = round(v.riskRatio, 1)
  const peak = Math.round(v.peakCycleDay)
  const peakPhrase =
    peak === 0
      ? 'on the first day of bleeding'
      : peak < 0
        ? `about ${Math.abs(peak)} day${Math.abs(peak) === 1 ? '' : 's'} before bleeding started`
        : `about ${peak} day${peak === 1 ? '' : 's'} after bleeding started`

  // Plain words for patient and clinician alike. The statistics behind a sentence
  // (test, interval, p-value) stay on the finding, never in the prose.
  const text =
    `${label} was recorded on ${v.menstrualPresent} of ${v.menstrualObserved} logged days around the period (${mwPct}%), ` +
    `compared with ${v.nonMenstrualPresent} of ${v.nonMenstrualObserved} logged days at other times (${nonPct}%), ` +
    `about ${rr} times as often. It was most common ${peakPhrase}.`

  // assertedValues is a contract: it lists the numbers that literally appear in the
  // sentence, so the fidelity checker verifies what a reader actually sees. When the
  // peak falls on D0 the sentence names it in words ("the first day of bleeding") and
  // no digit is printed, so the key is omitted rather than asserting an unprinted 0.
  const asserted: Record<string, number> = {
    menstrualPresent: v.menstrualPresent,
    menstrualObserved: v.menstrualObserved,
    menstrualRatePct: mwPct,
    nonMenstrualPresent: v.nonMenstrualPresent,
    nonMenstrualObserved: v.nonMenstrualObserved,
    nonMenstrualRatePct: nonPct,
    riskRatio: rr,
  }
  if (peak !== 0) asserted.peakCycleDayMagnitude = Math.abs(peak)

  return claim(f.id, 'findings', text, asserted, f.evidenceDates)
}

function renderPersistence(f: Finding, label: string): Claim {
  const v = f.values
  const text =
    `${label} was also recorded on ${v.nonMenstrualPresent} of ${v.nonMenstrualObserved} logged days ` +
    `away from the period (${pct(v.nonMenstrualRate)}%), so it is not limited to the period.`

  return claim(f.id, 'findings', text, {
    nonMenstrualPresent: v.nonMenstrualPresent,
    nonMenstrualObserved: v.nonMenstrualObserved,
    nonMenstrualRatePct: pct(v.nonMenstrualRate),
  }, f.evidenceDates)
}

function renderTrend(f: Finding, label: string): Claim {
  const v = f.values
  const direction = v.slopePerCycle > 0 ? 'more' : 'less'
  const text =
    `${label} became ${direction} frequent over ${v.cycles} cycles: it was recorded on ` +
    `${pct(v.firstCycleRate)}% of days in the first cycle and ${pct(v.lastCycleRate)}% in the most recent.`

  return claim(f.id, 'findings', text, {
    cycles: v.cycles,
    firstCycleRatePct: pct(v.firstCycleRate),
    lastCycleRatePct: pct(v.lastCycleRate),
  }, f.evidenceDates)
}

function renderCoOccurrence(f: Finding, labelA: string, labelB: string): Claim {
  const v = f.values
  const text =
    `${labelA} and ${labelB.toLowerCase()} tended to happen on the same days: both were recorded on ` +
    `${v.bothPresent} of the ${v.pairedDays} days when both were logged, more often than chance alone would explain.`

  return claim(f.id, 'findings', text, {
    bothPresent: v.bothPresent,
    pairedDays: v.pairedDays,
  }, f.evidenceDates)
}

function renderBaselineChange(f: Finding, label: string): Claim {
  const v = f.values
  const scope = v.restrictedToNonMenstrual ? ' on days away from the period' : ''
  const direction = v.latestRate > v.priorRate ? 'higher' : 'lower'
  const text =
    `${label}${scope} was recorded on ${v.latestPresent} of ${v.latestObserved} logged days ` +
    `in the most recent full cycle (${pct(v.latestRate)}%), ${direction} than the ${pct(v.priorRate)}% ` +
    `across the previous ${v.priorCycles} cycles (${v.priorPresent} of ${v.priorObserved} days).`

  return claim(f.id, 'change', text, {
    latestPresent: v.latestPresent,
    latestObserved: v.latestObserved,
    latestRatePct: pct(v.latestRate),
    priorPresent: v.priorPresent,
    priorObserved: v.priorObserved,
    priorRatePct: pct(v.priorRate),
    priorCycles: v.priorCycles,
  }, f.evidenceDates)
}

function renderTreatmentResponse(f: Finding, label: string, treatmentLabel: string, startDate: string): Claim {
  const v = f.values
  const direction = v.duringRate < v.beforeRate ? 'lower' : 'higher'
  const text =
    `Since ${treatmentLabel} began on ${formatDateLong(startDate)}, ${label.toLowerCase()} was recorded on ` +
    `${v.duringPresent} of ${v.duringObserved} logged days (${pct(v.duringRate)}%), ${direction} than the ` +
    `${pct(v.beforeRate)}% beforehand (${v.beforePresent} of ${v.beforeObserved} days). ` +
    `This compares days before and during treatment and is not a controlled comparison, so it does not show that the treatment caused the change.`

  return claim(f.id, 'medication', text, {
    duringPresent: v.duringPresent,
    duringObserved: v.duringObserved,
    duringRatePct: pct(v.duringRate),
    beforePresent: v.beforePresent,
    beforeObserved: v.beforeObserved,
    beforeRatePct: pct(v.beforeRate),
  }, f.evidenceDates)
}

function renderFunctionalBurden(f: Finding): Claim {
  const v = f.values
  const text =
    `Symptoms got in the way of normal activities on ${v.limitingDays} of ${v.observedDays} days when this was ` +
    `recorded (${pct(v.limitingRate)}%), including ` +
    `${v.couldNotPerformDays} day${v.couldNotPerformDays === 1 ? '' : 's'} when something important could not be done.`

  return claim(f.id, 'impact', text, {
    limitingDays: v.limitingDays,
    observedDays: v.observedDays,
    limitingRatePct: pct(v.limitingRate),
    couldNotPerformDays: v.couldNotPerformDays,
  }, f.evidenceDates)
}

/** How the report names each stored impact area. */
export const IMPACT_AREA_LABELS: Record<string, string> = {
  work: 'work',
  education: 'studies',
  exercise: 'exercise',
  walking: 'walking or getting around',
  sleep: 'sleep',
  household: 'household tasks',
  social: 'social life',
  concentration: 'concentration',
  mood: 'mood',
  'sexual activity': 'sexual activity',
}

/**
 * Which parts of life symptoms got in the way of. Impact is the outcome this app is
 * built around, so the areas get their own checked sentence. Sexual activity is a
 * separate claim, tied to the sexual-health module, so a share link leaves it out
 * unless that module is included.
 */
function renderImpactAreas(ctx: FeatureContext): Claim[] {
  const { domainCounts } = summariseImpact(ctx)
  const datesFor = (key: string) =>
    ctx.orderedDates.filter((d) => {
      const day = ctx.daysByDate.get(d)
      return day?.logged && day.impact !== undefined && (day.impactDomains ?? []).includes(key)
    })
  const name = (key: string) => IMPACT_AREA_LABELS[key] ?? key.toLowerCase()
  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`
  const out: Claim[] = []

  const top = Object.entries(domainCounts)
    .filter(([k, n]) => k !== 'sexual activity' && n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
  if (top.length > 0) {
    const parts = top.map(([k, n]) => `${name(k)} (${days(n)})`)
    const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    out.push(claim(
      'impact_areas',
      'impact',
      `The ${top.length === 1 ? 'area of life' : 'areas of life'} symptoms most often got in the way of ` +
        `${top.length === 1 ? 'was' : 'were'} ${list}.`,
      Object.fromEntries(top.map(([k, n]) => [`${AREA_KEY_PREFIX}${k}`, n])),
      [...new Set(top.flatMap(([k]) => datesFor(k)))].sort(),
    ))
  }

  const sexual = domainCounts['sexual activity'] ?? 0
  if (sexual > 0) {
    out.push(claim(
      'impact_sexual:dyspareunia',
      'impact',
      `Symptoms got in the way of sexual activity on ${days(sexual)}.`,
      { [`${AREA_KEY_PREFIX}sexual activity`]: sexual },
      datesFor('sexual activity'),
    ))
  }
  return out
}

// ---------------------------------------------------------------------------
// Brief assembly
// ---------------------------------------------------------------------------

export function generateBrief(
  ctx: FeatureContext,
  findings: Finding[],
  suppressed: Finding[],
  config: BriefConfig = DEFAULT_BRIEF_CONFIG,
): ConsultationBrief {
  const claims: Claim[] = []
  const label = (id?: string) => (id ? clinicalLabel(id, config.customLabels) : '')

  // --- Recorded period and coverage -----------------------------------------
  // Window-scoped, not record-scoped: quoting the whole record's cycle count in a
  // 92-day brief would overstate the evidence behind every number beneath it.
  const cycleSummary = summariseCycles(ctx.windowCycles)
  claims.push(
    claim(
      'period',
      'period',
      `Recorded ${formatDateLong(ctx.window.start)} to ${formatDateLong(ctx.window.end)}. ` +
        `${ctx.loggedDays} of ${ctx.calendarDays} days have an entry (${pct(ctx.coverage)}% of days logged).`,
      {
        loggedDays: ctx.loggedDays,
        calendarDays: ctx.calendarDays,
        coveragePct: pct(ctx.coverage),
      },
      [],
    ),
  )

  if (cycleSummary.completeCount === 1) {
    // One cycle has a length, not a median or a range ("range 14–14" reads as an error).
    claims.push(
      claim(
        'period',
        'period',
        `1 complete cycle observed, ${cycleSummary.medianLength} days long. ` +
          `Cycles are worked out from logged bleeding, not predicted.`,
        { completeCycles: 1, medianLength: cycleSummary.medianLength ?? 0 },
        [],
        ':cycles',
      ),
    )
  } else if (cycleSummary.completeCount > 1) {
    claims.push(
      claim(
        'period',
        'period',
        `${cycleSummary.completeCount} complete cycles observed, usually ${cycleSummary.medianLength} days long ` +
          `(shortest ${cycleSummary.minLength}, longest ${cycleSummary.maxLength}). ` +
          `Cycles are worked out from logged bleeding, not predicted.`,
        {
          completeCycles: cycleSummary.completeCount,
          medianLength: cycleSummary.medianLength ?? 0,
          minLength: cycleSummary.minLength ?? 0,
          maxLength: cycleSummary.maxLength ?? 0,
        },
        [],
        ':cycles',
      ),
    )
  }

  // --- Longitudinal findings -------------------------------------------------
  const ranked = rankFindings(findings)
  let reported = 0

  for (const f of ranked) {
    if (reported >= config.maxFindings) break

    if (f.kind === 'cyclicity') {
      claims.push(renderCyclicity(f, label(f.symptomId)))
      reported++
    } else if (f.kind === 'persistence') {
      if (f.values.nonMenstrualRate < config.persistenceFloor) continue
      claims.push(renderPersistence(f, label(f.symptomId)))
      reported++
    } else if (f.kind === 'trend') {
      claims.push(renderTrend(f, label(f.symptomId)))
      reported++
    } else if (f.kind === 'co_occurrence') {
      if (Math.abs(f.values.kappa) < config.kappaFloor) continue
      claims.push(renderCoOccurrence(f, label(f.symptomId), label(f.secondarySymptomId)))
      reported++
    } else if (f.kind === 'baseline_change') {
      claims.push(renderBaselineChange(f, label(f.symptomId)))
      reported++
    } else if (f.kind === 'treatment_response') {
      const treatmentId = f.id.split(':')[1]
      const treatment = ctx.record.treatments.find((t) => t.id === treatmentId)
      if (!treatment) continue
      claims.push(renderTreatmentResponse(f, label(f.symptomId), treatment.label, treatment.startDate))
      reported++
    } else if (f.kind === 'functional_burden') {
      claims.push(renderFunctionalBurden(f))
      reported++
    }
  }

  claims.push(...renderImpactAreas(ctx))

  // --- Medication ------------------------------------------------------------
  const meds = summariseMedication(ctx)
  if (meds.daysWithMedication > 0) {
    claims.push(
      claim(
        'medication_summary',
        'medication',
        `Painkillers were recorded on ${meds.daysWithMedication} days. On ${meds.severeDespiteMedication} of those days ` +
          `a symptom was still rated 7 or more out of 10.`,
        {
          daysWithMedication: meds.daysWithMedication,
          severeDespiteMedication: meds.severeDespiteMedication,
        },
        [],
      ),
    )
  }

  // --- Data quality ----------------------------------------------------------
  const gatedCount = suppressed.filter((f) => f.gateReason !== 'not_significant').length
  claims.push(
    claim(
      'data_quality',
      'quality',
      `All information above was recorded by the patient. Days without an entry are treated as unknown; ` +
        `they are not counted as symptom-free. A pattern is only included when it repeats across at least ` +
        `two cycles and is unlikely to be chance.` +
        (gatedCount > 0
          ? ` ${gatedCount} other possible pattern${gatedCount === 1 ? ' was' : 's were'} left out because there is not yet enough data.`
          : ''),
      gatedCount > 0 ? { gatedCount } : {},
      [],
    ),
  )

  return {
    patientId: ctx.record.profile.id,
    generatedAt: new Date().toISOString(),
    windowStart: ctx.window.start,
    windowEnd: ctx.window.end,
    calendarDays: ctx.calendarDays,
    loggedDays: ctx.loggedDays,
    cycles: cycleSummary.completeCount,
    claims,
    findings: ranked,
    suppressed,
  }
}

/** The main concerns list: the symptoms carrying the most reported burden. */
export function mainConcerns(ctx: FeatureContext, limit = 4, customLabels?: Record<string, string>): string[] {
  return [...ctx.features.values()]
    .filter((f) => f.daysPresent > 0)
    .sort((a, b) => {
      // Burden = how often it happened, weighted by how often it limited activity.
      const scoreA = a.daysPresent + 2 * a.impactDays + 1.5 * a.severeDays
      const scoreB = b.daysPresent + 2 * b.impactDays + 1.5 * b.severeDays
      return scoreB - scoreA
    })
    .slice(0, limit)
    .map((f) => clinicalLabel(f.symptomId, customLabels))
}

/**
 * The non-diagnostic boundary statement. Fixed text, always present, never generated.
 * It is a constant rather than a template so that no code path can vary or omit it.
 */
export const SAFETY_STATEMENT =
  'This document summarises patient-recorded observations over the stated period. ' +
  'It is not a diagnosis, does not assign a likelihood of endometriosis or any other condition, ' +
  'and is not a substitute for clinical assessment.'
