/**
 * Validation — how well the engine actually performs.
 *
 * Every number on this screen is read from src/eval/results/metrics.json, which is
 * produced by `npm run eval`. Nothing here is typed by hand, and the same file is the
 * source for every figure quoted in BUILDLOG.md, so the document and the app cannot
 * drift apart.
 *
 * The screen deliberately leads with the result that is unflattering: on raw F1 a
 * plain ratio rule beats this engine. Presenting only the favourable comparison would
 * be the kind of selective reporting the system is otherwise built to prevent.
 */

import {
  ConfusionMatrix,
  DataTable,
  Legend,
  LineSweep,
  SERIES,
  TableView,
} from '../charts'
import metrics from '../../eval/results/metrics.json'

const CLASSIFIER_LABEL: Record<string, string> = {
  medtrace: 'MedTrace (full engine)',
  descriptive: 'Ratio rule, no test',
  zero_imputed: 'Ratio rule + missing = 0',
}

export default function Validation() {
  const detection = metrics.detection
  const power = metrics.power
  const robustness = metrics.robustness
  const fidelity = metrics.fidelity
  const burden = metrics.burden
  const latency = metrics.latency

  const medtrace = detection.results.find((r) => r.classifier === 'medtrace')!
  const descriptive = detection.results.find((r) => r.classifier === 'descriptive')!
  const zeroImputed = detection.results.find((r) => r.classifier === 'zero_imputed')!

  const mcar = robustness.filter((r) => r.mode === 'mcar')
  const mar = robustness.filter((r) => r.mode === 'mar')

  return (
    <div className="space-y-5">
      <header>
        <h1 style={{ fontSize: 28 }}>Validation</h1>
        <p className="mt-1.5 max-w-3xl text-[13.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          The engine scored against synthetic cohorts where the right answer is known by
          construction. Generated {new Date(metrics.generatedAt).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'long', year: 'numeric',
          })} by <code className="mono">npm run eval</code>.
        </p>
      </header>

      <div className="card p-4" style={{ background: 'var(--amber-soft)', borderColor: 'var(--amber)' }}>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink)' }}>
          <strong>What these numbers are.</strong> Engine-validation results on synthetic data. They
          show that the detectors recover structure that is present and reject structure that is
          absent. They say nothing about clinical utility, diagnostic delay or patient outcomes —
          those would require a prospective clinical study, and no claim of that kind is made
          anywhere in this prototype.
        </p>
      </div>

      {/* ---------------- Detection ---------------- */}
      <section className="card p-5">
        <h2 style={{ fontSize: 18 }}>Cyclicity detection</h2>
        <p className="mt-1 max-w-3xl text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
          {detection.patients} synthetic patients × 4 symptoms ({medtrace.n} labelled cases), κ = {detection.kappa},{' '}
          {Math.round(detection.missingness.rate * 100)}% {detection.missingness.mode.toUpperCase()} missingness.
          Cyclical and non-cyclical symptoms are generated with <em>matched</em> overall prevalence, so a
          classifier that keys on frequency alone scores at chance.
        </p>

        <div className="mt-4 grid gap-5 lg:grid-cols-[400px_1fr]">
          <div>
            <h3 className="mb-2 text-[13px] font-semibold">MedTrace confusion matrix</h3>
            <ConfusionMatrix tp={medtrace.tp} fp={medtrace.fp} tn={medtrace.tn} fn={medtrace.fn} />
          </div>

          <div>
            <h3 className="mb-2 text-[13px] font-semibold">Compared with two ablations</h3>
            <DataTable
              head={['Classifier', 'Precision', 'Recall', 'F1', 'MCC', 'False positives']}
              rows={[medtrace, descriptive, zeroImputed].map((r) => [
                CLASSIFIER_LABEL[r.classifier],
                r.precision.toFixed(3),
                r.recall.toFixed(3),
                r.f1.toFixed(3),
                r.mcc.toFixed(3),
                r.fp,
              ])}
            />

            <div className="mt-4 rounded-xl p-4" style={{ background: 'var(--surface-sunken)' }}>
              <h4 className="text-[13px] font-semibold">Reading this honestly</h4>
              <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                On F1 the plain ratio rule wins ({descriptive.f1.toFixed(2)} vs {medtrace.f1.toFixed(2)}). It
                finds more real patterns because it applies no significance test at all. The cost is
                visible in the last column: it reports <strong>{descriptive.fp} false patterns</strong> where
                MedTrace reports <strong>{medtrace.fp}</strong>.
              </p>
              <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                That trade is deliberate, because the two errors are not symmetric here. A missed pattern
                leaves a patient where she already was. A fabricated one is printed in a document she hands
                to a gynaecologist, and it is indistinguishable on the page from a real finding. Precision
                of {medtrace.precision.toFixed(2)} is the property that makes the brief safe to hand over;
                recall of {medtrace.recall.toFixed(2)} is the price, and it is the clearest target for
                future work.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Power ---------------- */}
      <section className="card p-5">
        <h2 style={{ fontSize: 18 }}>Detection power vs effect size</h2>
        <p className="mt-1 max-w-3xl text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
          How tightly a symptom must cluster before the engine will report it. The x-axis is the mean
          resultant length R̄ of the generating distribution — 0 is uniform around the cycle, 1 is a
          single day. Expected prevalence is held constant across the sweep, so this varies effect
          size and nothing else.
        </p>

        <div className="mt-4 flex flex-wrap gap-6">
          <div>
            <LineSweep
              series={[
                { label: 'MedTrace recall', color: SERIES[0], points: power.map((p) => ({ x: p.concentration, y: p.medtrace.recall })) },
                { label: 'MedTrace specificity', color: SERIES[1], points: power.map((p) => ({ x: p.concentration, y: p.medtrace.specificity })) },
                { label: 'Ratio rule recall', color: SERIES[2], points: power.map((p) => ({ x: p.concentration, y: p.descriptive.recall })) },
              ]}
              xLabel="Concentration R̄"
              yLabel="Rate"
              formatX={(x) => x.toFixed(2)}
            />
            <div className="mt-2">
              <Legend
                items={[
                  { label: 'MedTrace recall', color: SERIES[0] },
                  { label: 'MedTrace specificity', color: SERIES[1] },
                  { label: 'Ratio rule recall', color: SERIES[2] },
                ]}
              />
            </div>
          </div>

          <div className="max-w-sm rounded-xl p-4" style={{ background: 'var(--surface-sunken)' }}>
            <h4 className="text-[13px] font-semibold">Interpretation</h4>
            <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              Recall rises monotonically with concentration while specificity stays near 1 throughout.
              That is the shape a well-behaved detector should have: it becomes more willing to report
              as the underlying pattern strengthens, without becoming more willing to invent one.
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              At R̄ ≈ 0.2 — a symptom only slightly more common around menstruation — the engine reports
              almost nothing. That is correct behaviour, not a failure: at that effect size, three cycles
              of data cannot distinguish the pattern from noise.
            </p>
          </div>
        </div>

        <TableView>
          <DataTable
            head={['κ', 'R̄', 'MedTrace recall', 'MedTrace specificity', 'MedTrace F1', 'Ratio-rule F1']}
            rows={power.map((p) => [
              p.kappa.toFixed(1),
              p.concentration.toFixed(2),
              p.medtrace.recall.toFixed(2),
              p.medtrace.specificity.toFixed(2),
              p.medtrace.f1.toFixed(2),
              p.descriptive.f1.toFixed(2),
            ])}
          />
        </TableView>
      </section>

      {/* ---------------- Robustness ---------------- */}
      <section className="card p-5">
        <h2 style={{ fontSize: 18 }}>Robustness to missing data</h2>
        <p className="mt-1 max-w-3xl text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
          F1 as coverage falls, under two missingness mechanisms. MCAR drops days at random. MAR drops
          them in the direction that actually hurts: the worse the day, the more likely it went
          unlogged — which preferentially removes perimenstrual days and attenuates the signal. The two
          are compared at matched coverage, not at matched drop rate.
        </p>

        <div className="mt-4 flex flex-wrap gap-6">
          <div>
            <LineSweep
              series={[
                { label: 'MCAR, gate on', color: SERIES[0], points: mcar.map((r) => ({ x: r.meanCoverage, y: r.gated.f1 })) },
                { label: 'MAR, gate on', color: SERIES[1], points: mar.map((r) => ({ x: r.meanCoverage, y: r.gated.f1 })) },
                { label: 'MCAR, gate off', color: SERIES[2], points: mcar.map((r) => ({ x: r.meanCoverage, y: r.ungated.f1 })) },
              ]}
              xLabel="Observed-day coverage"
              yLabel="F1"
              formatX={(x) => `${Math.round(x * 100)}%`}
            />
            <div className="mt-2">
              <Legend
                items={[
                  { label: 'MCAR, gate on', color: SERIES[0] },
                  { label: 'MAR, gate on', color: SERIES[1] },
                  { label: 'MCAR, gate off', color: SERIES[2] },
                ]}
              />
            </div>
          </div>

          <div className="max-w-sm space-y-3">
            <div className="rounded-xl p-4" style={{ background: 'var(--surface-sunken)' }}>
              <h4 className="text-[13px] font-semibold">MAR is the harder case, as expected</h4>
              <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                At roughly 70% coverage, F1 is {mcar.find((r) => Math.abs(r.meanCoverage - 0.71) < 0.03)?.gated.f1.toFixed(2) ?? '—'} under MCAR
                but {mar.find((r) => Math.abs(r.meanCoverage - 0.69) < 0.03)?.gated.f1.toFixed(2) ?? '—'} under MAR. Losing the bad days costs
                more than losing random days, which is why coverage alone is not a sufficient quality
                measure.
              </p>
            </div>

            <div className="rounded-xl p-4" style={{ background: 'var(--surface-sunken)' }}>
              <h4 className="text-[13px] font-semibold">The gate is conservative — measurably so</h4>
              <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                Below 60% coverage the gate reports nothing, so F1 falls to zero by design while the
                ungated detector still reaches {mcar.find((r) => r.meanCoverage < 0.6 && r.meanCoverage > 0.5)?.ungated.f1.toFixed(2) ?? '—'} at
                precision {mcar.find((r) => r.meanCoverage < 0.6 && r.meanCoverage > 0.5)?.ungated.precision.toFixed(2) ?? '—'}. The 0.60
                threshold was fixed in advance rather than fitted, and this synthetic data does not
                fully represent the real logging bias it exists to guard against — so it has not been
                retuned here. Choosing it properly needs real records.
              </p>
            </div>
          </div>
        </div>

        <TableView>
          <DataTable
            head={['Mode', 'Drop rate', 'Coverage', 'F1 (gate on)', 'Precision (gate on)', 'F1 (gate off)', 'Precision (gate off)']}
            rows={robustness.map((r) => [
              r.mode.toUpperCase(),
              `${Math.round(r.missingnessRate * 100)}%`,
              `${Math.round(r.meanCoverage * 100)}%`,
              r.gated.f1.toFixed(2),
              r.gated.precision.toFixed(2),
              r.ungated.f1.toFixed(2),
              r.ungated.precision.toFixed(2),
            ])}
          />
        </TableView>
      </section>

      {/* ---------------- Fidelity, burden, latency ---------------- */}
      <div className="grid gap-5 md:grid-cols-3">
        <section className="card p-5">
          <h2 style={{ fontSize: 17 }}>Brief fidelity</h2>
          <Big value={`${Math.round(fidelity.verificationRate * 100)}%`} label={`${fidelity.verifiedClaims} of ${fidelity.totalClaims} claims verified`} />
          <Big value={`${Math.round(fidelity.mutationCatchRate * 100)}%`} label={`${fidelity.mutationsCaught} of ${fidelity.mutationsInjected} injected errors caught`} />
          <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            A 100% verification rate alone would prove little — a checker that always says yes scores
            the same. The mutation test is what makes it meaningful: corrupt a number in a claim, and
            the checker must reject it. {Math.round(fidelity.keyCoverage * 100)}% of asserted values are
            re-derived from raw records; the remainder are test statistics computed from counts already
            confirmed.
          </p>
        </section>

        <section className="card p-5">
          <h2 style={{ fontSize: 17 }}>Logging burden</h2>
          <Big value={burden.meanAdaptiveFields.toFixed(1)} label="fields presented per day, adaptive" />
          <Big value={`${Math.round(burden.reductionVsFullVocabulary * 100)}%`} label={`fewer than a fixed ${burden.fullVocabularyFields}-field questionnaire`} />
          <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            Measured over {burden.patientDays} simulated patient-days. Against the patient&apos;s own
            tracked vocabulary the reduction is a more modest {Math.round(burden.reduction * 100)}%.
            Time is <em>estimated</em> at {burden.secondsPerFieldAssumption}s per field — an assumption,
            not a user measurement.
          </p>
        </section>

        <section className="card p-5">
          <h2 style={{ fontSize: 17 }}>Engine latency</h2>
          <Big value={`${latency.p50Ms.toFixed(0)} ms`} label={`median, full pipeline on ${latency.recordDays} days`} />
          <Big value={`${latency.p95Ms.toFixed(0)} ms`} label="95th percentile" />
          <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            Dominated by the permutation tests for co-occurrence ({latency.stageBreakdownMs.patterns.toFixed(0)} ms of
            it). Feature building is {latency.stageBreakdownMs.features.toFixed(1)} ms and the fidelity
            re-derivation {latency.stageBreakdownMs.fidelity.toFixed(1)} ms, so verification costs a few
            percent of the total — cheap enough to run on every render.
          </p>
        </section>
      </div>

      <section className="card p-5">
        <h2 style={{ fontSize: 18 }}>Known limitations</h2>
        <ul className="mt-2 space-y-2 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
          {[
            'All results are on synthetic data. The generator embodies our own assumptions about how endometriosis symptoms behave across a cycle; if those assumptions are wrong, these numbers are measuring the wrong thing.',
            'Recall of ' + medtrace.recall.toFixed(2) + ' means roughly a third of genuinely cyclical symptoms are never reported to the clinician. That is a real cost, not a rounding error.',
            'The coverage gate at 0.60 is pre-registered but unvalidated against real logging behaviour.',
            'Cyclicity is the only pattern class with a labelled ground truth here. Trend, co-occurrence and treatment-response detection are exercised by unit tests but not scored on a labelled cohort.',
            'No clinician has evaluated whether the brief is readable, relevant, or usable inside a real consultation.',
          ].map((t) => (
            <li key={t} className="flex gap-2.5">
              <span aria-hidden style={{ color: 'var(--ink-muted)' }}>—</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Big({ value, label }: { value: string; label: string }) {
  return (
    <div className="mt-3">
      <div className="display tnum" style={{ fontSize: 34, lineHeight: 1.05 }}>{value}</div>
      <div className="text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>{label}</div>
    </div>
  )
}
