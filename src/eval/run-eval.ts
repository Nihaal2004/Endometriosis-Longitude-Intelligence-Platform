/**
 * run-eval.ts — CLI entry point for the evaluation harness.
 *
 *   npm run eval
 *
 * Writes src/eval/results/metrics.json. That file is the single source of truth for
 * every number quoted in BUILDLOG.md and rendered on the in-app Validation screen —
 * no metric is ever typed by hand into either.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runFullEvaluation, type EvaluationReport } from './harness'

const here = dirname(fileURLToPath(import.meta.url))
const outputDir = join(here, 'results')
const outputPath = join(outputDir, 'metrics.json')

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

function padLeft(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s
}

function summarise(report: EvaluationReport): void {
  const line = (s = '') => console.log(s)

  line()
  line('  MedTrace — engine evaluation')
  line('  ' + '─'.repeat(72))
  line(`  Synthetic cohorts with known ground truth. Engine v${report.engineVersion}.`)
  line()

  // --- Detection ---
  line('  1. CYCLICITY DETECTION')
  line(`     ${report.detection.patients} patients x 4 symptoms, kappa=${report.detection.kappa}, ` +
    `${pct(report.detection.missingness.rate)} ${report.detection.missingness.mode.toUpperCase()} missingness`)
  line()
  line('     ' + pad('classifier', 16) + padLeft('prec', 8) + padLeft('recall', 8) +
    padLeft('F1', 8) + padLeft('MCC', 8) + padLeft('TP', 6) + padLeft('FP', 6) +
    padLeft('TN', 6) + padLeft('FN', 6))
  for (const r of report.detection.results) {
    line('     ' + pad(r.classifier, 16) +
      padLeft(r.precision.toFixed(3), 8) +
      padLeft(r.recall.toFixed(3), 8) +
      padLeft(r.f1.toFixed(3), 8) +
      padLeft(r.mcc.toFixed(3), 8) +
      padLeft(String(r.tp), 6) + padLeft(String(r.fp), 6) +
      padLeft(String(r.tn), 6) + padLeft(String(r.fn), 6))
  }
  line()

  // --- Power ---
  line('  2. DETECTION POWER vs EFFECT SIZE')
  line('     ' + pad('kappa', 8) + pad('R-bar', 9) + padLeft('recall', 9) +
    padLeft('spec', 9) + padLeft('F1', 9) + padLeft('desc F1', 10))
  for (const p of report.power) {
    line('     ' + pad(p.kappa.toFixed(1), 8) + pad(p.concentration.toFixed(2), 9) +
      padLeft(p.medtrace.recall.toFixed(2), 9) +
      padLeft(p.medtrace.specificity.toFixed(2), 9) +
      padLeft(p.medtrace.f1.toFixed(2), 9) +
      padLeft(p.descriptive.f1.toFixed(2), 10))
  }
  line()

  // --- Robustness ---
  line('  3. ROBUSTNESS TO MISSING DATA')
  line('     ' + pad('mode', 7) + pad('miss', 7) + pad('cover', 8) +
    padLeft('gated F1', 10) + padLeft('gated P', 9) +
    padLeft('ungated F1', 12) + padLeft('ungated P', 11) + padLeft('zeroimp P', 11))
  for (const p of report.robustness) {
    line('     ' + pad(p.mode, 7) + pad(pct(p.missingnessRate), 7) +
      pad(pct(p.meanCoverage), 8) +
      padLeft(p.gated.f1.toFixed(2), 10) +
      padLeft(p.gated.precision.toFixed(2), 9) +
      padLeft(p.ungated.f1.toFixed(2), 12) +
      padLeft(p.ungated.precision.toFixed(2), 11) +
      padLeft(p.zeroImputed.precision.toFixed(2), 11))
  }
  line()

  // --- Fidelity ---
  const f = report.fidelity
  line('  4. BRIEF FIDELITY')
  line(`     briefs generated        ${f.briefsGenerated}`)
  line(`     claims verified         ${f.verifiedClaims}/${f.totalClaims}  (${pct(f.verificationRate)})`)
  line(`     asserted values re-derived independently  ${pct(f.keyCoverage)}`)
  line(`     injected mutations caught  ${f.mutationsCaught}/${f.mutationsInjected}  (${pct(f.mutationCatchRate)})`)
  line()

  // --- Burden ---
  const b = report.burden
  line('  5. LOGGING BURDEN')
  line(`     fields/day adaptive     ${b.meanAdaptiveFields.toFixed(1)}`)
  line(`     fields/day static (patient's own vocabulary)  ${b.meanStaticFields.toFixed(1)}  -> ${pct(b.reduction)} reduction`)
  line(`     fields/day static (full supported vocabulary) ${b.fullVocabularyFields.toFixed(1)}  -> ${pct(b.reductionVsFullVocabulary)} reduction`)
  line(`     est. seconds/day        ${b.estimatedSecondsAdaptive.toFixed(0)}s vs ${b.estimatedSecondsStatic.toFixed(0)}s ` +
    `(assumes ${b.secondsPerFieldAssumption}s per field)`)
  line()

  // --- Latency ---
  const l = report.latency
  line('  6. ENGINE LATENCY')
  line(`     ${l.recordDays}-day record, ${l.runs} runs`)
  line(`     p50 ${l.p50Ms.toFixed(1)} ms   p95 ${l.p95Ms.toFixed(1)} ms   max ${l.maxMs.toFixed(1)} ms`)
  line(`     features ${l.stageBreakdownMs.features.toFixed(1)}ms | ` +
    `patterns ${l.stageBreakdownMs.patterns.toFixed(1)}ms | ` +
    `brief ${l.stageBreakdownMs.brief.toFixed(1)}ms | ` +
    `fidelity ${l.stageBreakdownMs.fidelity.toFixed(1)}ms`)
  line()
  line('  ' + '─'.repeat(72))
  line('  These are engine-validation results on synthetic data with known ground')
  line('  truth. They say nothing about clinical utility, diagnostic delay, or')
  line('  patient outcomes, which would require prospective clinical evaluation.')
  line()
}

const started = Date.now()
console.log('\n  Running evaluation (this takes a minute — permutation tests)...')

const report = runFullEvaluation()

mkdirSync(outputDir, { recursive: true })
writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8')

summarise(report)
console.log(`  Wrote ${outputPath}`)
console.log(`  Completed in ${((Date.now() - started) / 1000).toFixed(1)}s\n`)
