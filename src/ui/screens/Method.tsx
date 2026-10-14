/**
 * Method — the architecture and the reasoning behind it, in the app itself.
 *
 * This screen exists because the product's central claim is about *how* a number was
 * produced, not what the number is. A reader who cannot see the pipeline has no basis
 * for trusting the brief over any other app's "insights".
 */

import { DEFAULT_GATE } from '../../engine/patterns'
import { DEFAULT_CYCLE_CONFIG } from '../../engine/cycles'
import { useAnalysis } from '../data'

const PIPELINE = [
  { stage: 'Patient entry', detail: 'Bleeding, pain, impact, adaptive symptom chips. Unasked questions are recorded as unknown.' },
  { stage: 'Cycle segmentation', detail: 'Cycles derived from recorded bleeding onsets only. Each keeps its own observed length.' },
  { stage: 'Feature engine', detail: 'Per-symptom rates, always paired with the number of observed days they came from.' },
  { stage: 'Pattern engine', detail: 'One named statistical test per clinical question, with effect size and confidence interval.' },
  { stage: 'Multiplicity + gate', detail: 'Benjamini–Hochberg within each pattern family, then coverage, cycle and event floors.' },
  { stage: 'Brief generation', detail: 'Templated sentences. Numeric slots filled from findings — never written by a model.' },
  { stage: 'Fidelity check', detail: 'Every asserted number re-derived from raw records by a separate implementation.' },
  { stage: 'Patient review', detail: 'Nothing is shared until the patient has seen the exact document.' },
]

const METHODS = [
  {
    question: 'Is this symptom concentrated around menstruation?',
    method: "Fisher's exact test on a perimenstrual vs rest-of-cycle 2×2, with a risk ratio and log-transformed CI",
    why: 'Expected cell counts are routinely below 5 — three cycles give only ~18 perimenstrual days — where the chi-square approximation is invalid.',
    instead: 'χ² test; Pearson correlation with cycle day',
  },
  {
    question: 'Where in the cycle does it peak, without a window boundary?',
    method: 'Rayleigh test on phase angles, reported as a cross-check',
    why: 'Treats the cycle as a circle, so it cannot be an artefact of where the perimenstrual window was drawn. Angles come from each cycle’s own length.',
    instead: 'Assuming a 28-day cycle and binning by calendar day',
  },
  {
    question: 'Is it getting worse?',
    method: 'Mann–Kendall trend test with Theil–Sen slope',
    why: 'Rank-based: assumes monotonicity, not linearity or normality, and is not dragged by one bad cycle out of four.',
    instead: 'Least-squares regression on 4 points',
  },
  {
    question: 'Which symptoms travel together?',
    method: "Cohen's κ with a permutation null",
    why: 'κ discounts the overlap two common symptoms produce by chance. Consecutive days are not independent, so the asymptotic variance would be optimistic.',
    instead: 'Raw co-occurrence counts; Pearson correlation on binary data',
  },
  {
    question: 'Has this changed from her own baseline?',
    method: 'Exact conditional Poisson rate comparison',
    why: 'A single cycle may contribute 3–8 events. At those counts a normal-approximation two-sample Poisson test is unreliable.',
    instead: 'Comparing this month to a population average',
  },
  {
    question: 'How many of these findings are spurious?',
    method: 'Benjamini–Hochberg FDR within each pattern family',
    why: 'The engine runs ~19 tests per patient. Uncorrected, we would expect a false finding in nearly every brief. FDR suits screening; Bonferroni would discard too much power.',
    instead: 'Uncorrected α = 0.05 across all tests',
  },
]

export default function Method() {
  const { ctx, patterns } = useAnalysis()

  return (
    <div className="space-y-5">
      <header>
        <h1 style={{ fontSize: 28 }}>Method</h1>
        <p className="mt-1.5 max-w-3xl text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          The product claim is about how a number is produced, not just what it says. This is the
          pipeline, the tests, and the parameters — all of it inspectable rather than asserted.
        </p>
      </header>

      {/* ---------------- Pipeline ---------------- */}
      <section className="card p-5">
        <h2 style={{ fontSize: 18 }}>Where the calculation happens</h2>
        <p className="mt-1 max-w-3xl text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
          Nothing statistical happens inside a language model, and nothing happens inside a React
          component. The engine is pure TypeScript with no React import anywhere in it, so that
          boundary is structural rather than a promise.
        </p>

        <ol className="mt-4 space-y-0">
          {PIPELINE.map((p, i) => (
            <li key={p.stage} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span
                  className="tnum flex items-center justify-center text-[11.5px] font-semibold"
                  style={{
                    width: 26, height: 26, borderRadius: 999,
                    background: i >= 5 ? 'var(--violet-soft)' : 'var(--surface-sunken)',
                    color: 'var(--ink)', flexShrink: 0,
                  }}
                >
                  {i + 1}
                </span>
                {i < PIPELINE.length - 1 && (
                  <span style={{ width: 2, flex: 1, minHeight: 20, background: 'var(--hairline)' }} />
                )}
              </div>
              <div className="pb-4">
                <div className="text-[14px] font-semibold">{p.stage}</div>
                <div className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>{p.detail}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------- Methods table ---------------- */}
      <section className="card p-5">
        <h2 style={{ fontSize: 18 }}>One question, one named test</h2>
        <div className="mt-4 space-y-3">
          {METHODS.map((m) => (
            <div key={m.question} className="rounded-xl p-4" style={{ background: 'var(--surface-sunken)' }}>
              <h3 style={{ fontSize: 15 }}>{m.question}</h3>
              <p className="mt-1.5 text-[13.5px] font-medium" style={{ color: 'var(--violet)' }}>{m.method}</p>
              <p className="mt-1.5 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>{m.why}</p>
              <p className="mt-1.5 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
                Rejected: {m.instead}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- Parameters ---------------- */}
      <section className="card p-5">
        <h2 style={{ fontSize: 18 }}>Parameters, and why they are what they are</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Parameter', 'Value', 'Rationale'].map((h) => (
                  <th key={h} className="px-2.5 py-2 text-left text-[12px] font-medium"
                    style={{ color: 'var(--ink-muted)', borderBottom: '1px solid var(--hairline)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ['Perimenstrual window', `D−${DEFAULT_CYCLE_CONFIG.windowBefore} to D+${DEFAULT_CYCLE_CONFIG.windowAfter}`, 'Endometriosis pain characteristically begins 1–2 days before onset and persists through early flow. Fixed in advance, never tuned per patient, so the rate means the same thing in every brief.'],
                ['Minimum cycle gap', `${DEFAULT_CYCLE_CONFIG.minCycleGapDays} days`, 'Permissive on purpose. Short and irregular cycles are common in this population; better to merge two runs than to invent a cycle boundary that did not happen.'],
                ['Coverage floor', `${DEFAULT_GATE.minCoverage * 100}%`, 'Below roughly half, a rate computed from self-selected days is badly exposed to the bias that people log more on bad days. Pre-registered, not fitted — and measurably conservative, as the Validation screen shows.'],
                ['Complete cycles', `${DEFAULT_GATE.minCompleteCycles}`, 'A pattern seen once is an episode. Repetition across cycles is what makes it a pattern.'],
                ['Minimum events', `${DEFAULT_GATE.minEvents}`, 'Below four occurrences, a rate ratio is dominated by whether one extra day happened to fall inside the window.'],
                ['FDR level', `q < ${DEFAULT_GATE.alpha}`, 'Applied within each pattern family. Correcting all families jointly was measured to suppress true findings with raw p as low as 0.004.'],
                ['Severity threshold', '≥ 7 of 10', 'Marks a "severe day" in the brief. A reporting convention, not a clinical cut-off.'],
                ['Permutation iterations', `${DEFAULT_GATE.permutations}`, 'Fixed seed, so a brief regenerated tomorrow contains identical numbers.'],
              ].map(([p, v, r]) => (
                <tr key={p}>
                  <td className="px-2.5 py-2.5 align-top font-medium" style={{ borderBottom: '1px solid var(--hairline)' }}>{p}</td>
                  <td className="px-2.5 py-2.5 align-top tnum" style={{ borderBottom: '1px solid var(--hairline)', whiteSpace: 'nowrap' }}>{v}</td>
                  <td className="px-2.5 py-2.5 align-top" style={{ color: 'var(--ink-secondary)', borderBottom: '1px solid var(--hairline)' }}>{r}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------- Live counters ---------------- */}
      <section className="card p-5">
        <h2 style={{ fontSize: 18 }}>This patient, right now</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ['Tests run', String(patterns.testsRun)],
            ['Findings reported', String(patterns.findings.length)],
            ['Findings withheld', String(patterns.suppressed.length)],
            ['Symptoms tracked', String(ctx.symptomIds.length)],
            ['Observed days', String(ctx.loggedDays)],
            ['Complete cycles', String(ctx.windowCycles.filter((c) => c.complete).length)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl px-4 py-3" style={{ background: 'var(--surface-sunken)', minWidth: 124 }}>
              <div className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>{label}</div>
              <div className="display tnum" style={{ fontSize: 24 }}>{value}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 max-w-3xl text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
          More findings are withheld than reported. That ratio is the system working as intended, not a
          shortage of data.
        </p>
      </section>
    </div>
  )
}
