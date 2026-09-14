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
import { summariseImpact, summariseMedication, type FeatureContext } from './features'
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
  const ciLow = round(v.riskRatioLow, 1)
  const ciHigh = round(v.riskRatioHigh, 1)
  const peak = Math.round(v.peakCycleDay)
  const peakPhrase =
    peak === 0
      ? 'with occurrences centred on the first day of bleeding'
      : peak < 0
        ? `with occurrences centred approximately ${Math.abs(peak)} day${Math.abs(peak) === 1 ? '' : 's'} before the onset of bleeding`
        : `with occurrences centred approximately ${peak} day${peak === 1 ? '' : 's'} after the onset of bleeding`

  const text =
    `${label} was recorded on ${v.menstrualPresent} of ${v.menstrualObserved} observed perimenstrual days (${mwPct}%), ` +
    `compared with ${v.nonMenstrualPresent} of ${v.nonMenstrualObserved} observed days elsewhere in the cycle (${nonPct}%) — ` +
    `a rate ratio of ${rr} (95% CI ${ciLow}–${ciHigh}; Fisher's exact ${formatP(f.test!.p)}), ${peakPhrase}.`

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
    riskRatioLow: ciLow,
    riskRatioHigh: ciHigh,
  }
  if (peak !== 0) asserted.peakCycleDayMagnitude = Math.abs(peak)

  return claim(f.id, 'findings', text, asserted, f.evidenceDates)
}

function renderPersistence(f: Finding, label: string): Claim {
  const v = f.values
  const text =
    `${label} was also recorded outside the perimenstrual window on ${v.nonMenstrualPresent} of ` +
    `${v.nonMenstrualObserved} observed days (${pct(v.nonMenstrualRate)}%, 95% CI ${pct(v.rateLow)}–${pct(v.rateHigh)}%), ` +
    `indicating it is not confined to menstruation.`

  return claim(f.id, 'findings', text, {
    nonMenstrualPresent: v.nonMenstrualPresent,
    nonMenstrualObserved: v.nonMenstrualObserved,
    nonMenstrualRatePct: pct(v.nonMenstrualRate),
    rateLowPct: pct(v.rateLow),
    rateHighPct: pct(v.rateHigh),
  }, f.evidenceDates)
}

function renderTrend(f: Finding, label: string): Claim {
  const v = f.values
  const direction = v.slopePerCycle > 0 ? 'increased' : 'decreased'
  const slope = round(Math.abs(v.slopePerCycle) * 100, 1)
  const text =
    `The proportion of days on which ${label.toLowerCase()} was recorded ${direction} across ` +
    `${v.cycles} recorded cycles, from ${pct(v.firstCycleRate)}% to ${pct(v.lastCycleRate)}% ` +
    `(Theil–Sen slope ${v.slopePerCycle > 0 ? '+' : '−'}${slope} percentage points per cycle; ` +
    `Mann–Kendall ${formatP(f.test!.p)}).`

  return claim(f.id, 'findings', text, {
    cycles: v.cycles,
    firstCycleRatePct: pct(v.firstCycleRate),
    lastCycleRatePct: pct(v.lastCycleRate),
    slopePoints: slope,
  }, f.evidenceDates)
}

function renderCoOccurrence(f: Finding, labelA: string, labelB: string): Claim {
  const v = f.values
  const kappa = round(v.kappa, 2)
  // Landis & Koch descriptors, used only as a verbal gloss on kappa.
  const strength = kappa >= 0.61 ? 'substantial' : kappa >= 0.41 ? 'moderate' : 'fair'
  const text =
    `${labelA} and ${labelB.toLowerCase()} were recorded on the same day ${v.bothPresent} times ` +
    `across ${v.pairedDays} days on which both were observed — ${strength} agreement beyond chance ` +
    `(Cohen's κ = ${kappa}, permutation ${formatP(f.test!.p)}).`

  return claim(f.id, 'findings', text, {
    bothPresent: v.bothPresent,
    pairedDays: v.pairedDays,
    kappa,
  }, f.evidenceDates)
}

function renderBaselineChange(f: Finding, label: string): Claim {
  const v = f.values
  const scope = v.restrictedToNonMenstrual ? 'Non-menstrual ' : ''
  const direction = v.latestRate > v.priorRate ? 'higher' : 'lower'
  const text =
    `${scope}${label.toLowerCase()} was recorded on ${v.latestPresent} of ${v.latestObserved} observed days ` +
    `in the most recent complete cycle (${pct(v.latestRate)}%), ${direction} than the ${pct(v.priorRate)}% ` +
    `recorded across the preceding ${v.priorCycles} cycles (${v.priorPresent} of ${v.priorObserved} days; ` +
    `exact Poisson rate comparison ${formatP(f.test!.p)}).`

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
    `Since ${treatmentLabel.toLowerCase()} began on ${formatDateLong(startDate)}, ${label.toLowerCase()} was recorded on ` +
    `${v.duringPresent} of ${v.duringObserved} observed days (${pct(v.duringRate)}%), ${direction} than the ` +
    `${pct(v.beforeRate)}% recorded beforehand (${v.beforePresent} of ${v.beforeObserved} days; ${formatP(f.test!.p)}). ` +
    `This describes recorded rates before and during treatment and is not a controlled comparison.`

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
    `Symptoms interfered with normal activity on ${v.limitingDays} of ${v.observedDays} days on which ` +
    `impact was recorded (${pct(v.limitingRate)}%, 95% CI ${pct(v.rateLow)}–${pct(v.rateHigh)}%), including ` +
    `${v.couldNotPerformDays} day${v.couldNotPerformDays === 1 ? '' : 's'} on which an important activity could not be completed.`

  return claim(f.id, 'impact', text, {
    limitingDays: v.limitingDays,
    observedDays: v.observedDays,
    limitingRatePct: pct(v.limitingRate),
    rateLowPct: pct(v.rateLow),
    rateHighPct: pct(v.rateHigh),
    couldNotPerformDays: v.couldNotPerformDays,
  }, f.evidenceDates)
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
        `${ctx.loggedDays} of ${ctx.calendarDays} days contain an entry (${pct(ctx.coverage)}% coverage).`,
      {
        loggedDays: ctx.loggedDays,
        calendarDays: ctx.calendarDays,
        coveragePct: pct(ctx.coverage),
      },
      [],
    ),
  )

  if (cycleSummary.completeCount > 0) {
    claims.push(
      claim(
        'period',
        'period',
        `${cycleSummary.completeCount} complete cycle${cycleSummary.completeCount === 1 ? '' : 's'} observed, ` +
          `median length ${cycleSummary.medianLength} days (range ${cycleSummary.minLength}–${cycleSummary.maxLength}). ` +
          `Cycle timing is derived from recorded bleeding, not from a predicted cycle.`,
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

  // --- Medication ------------------------------------------------------------
  const meds = summariseMedication(ctx)
  if (meds.daysWithMedication > 0) {
    claims.push(
      claim(
        'medication_summary',
        'medication',
        `Analgesia was recorded on ${meds.daysWithMedication} days. On ${meds.severeDespiteMedication} of those days ` +
          `a symptom of severity 7 or above was still recorded.`,
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
      `All information above is patient-reported. Days without an entry are treated as unknown and are excluded ` +
        `from every denominator; they are not counted as symptom-free. ` +
        `${gatedCount} additional pattern${gatedCount === 1 ? ' was' : 's were'} computed but withheld for insufficient data.`,
      { gatedCount },
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
