# MedTrace

**A longitudinal symptom-intelligence prototype for endometriosis.**

Endometriosis carries a mean interval of roughly 6.8 years from first symptom to diagnosis. The delay is not caused by an absence of symptoms — it is caused by the absence of structured longitudinal evidence at the moment of consultation. Symptoms accumulate across years; a consultation sees fifteen minutes reconstructed from memory.

MedTrace builds a structured record from very small daily interactions, computes patterns from it deterministically, and renders them as a one-page clinician brief in which **every sentence is traceable to the days that produced it**.

It does not diagnose, does not score risk, does not stage disease, and does not predict cycles.

---

## Run it

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # 111 tests
npm run eval    # regenerate all reported metrics (~60s)
```

Three demo patients ship with the prototype, each exercising a different engine behaviour: **Maya** (a clear perimenstrual pattern), **Priya** (persistent non-cyclical pain with a treatment episode), and **Aisha** (a sparse record where the engine withholds nearly everything).

## Screens

| Screen | What it shows |
|---|---|
| **Today** | The adaptive check-in — ~7 fields out of a 100+ field model, with the skipped questions explained |
| **Patterns** | Cycle-phase heatmap, findings with test/effect size/CI/coverage, and findings *withheld* with reasons |
| **Timeline** | Symptom burden against treatment periods and healthcare events |
| **Brief** | The clinician one-pager; click any sentence for its evidence |
| **Validation** | Live engine metrics from the evaluation harness |
| **Method** | The pipeline, the tests, and every parameter with its rationale |

## How it works

```
entry → cycle segmentation → feature engine → pattern engine
      → multiplicity + evidence gate → brief generation
      → fidelity check → patient review → clinician
```

Three properties do the work:

**Missing data is never zero.** Every symptom-day is `present`, `absent`, or `unknown`, and `unknown` is excluded from every denominator. A day you skipped contributes to nothing, and coverage is reported alongside every finding.

**One question, one named test.** Fisher's exact for cyclicity, Rayleigh on circular phase as a cross-check, Mann–Kendall with Theil–Sen for trend, Cohen's κ with a permutation null for co-occurrence, exact conditional Poisson for baseline change — all corrected by Benjamini–Hochberg within family, then gated on coverage, cycles and event count. Non-parametric throughout, because the data is ordinal, small-n and zero-inflated.

**No number is written by a language model.** Sentences are templated; numeric slots come from computed findings. A fidelity checker then re-derives every asserted number from the raw records through a *separately written* implementation and drops any claim that disagrees. In evaluation it caught 194 of 194 deliberately injected errors.

## Documentation

| Document | Contents |
|---|---|
| [`BUILDLOG.md`](BUILDLOG.md) | Methods and their rationale, full evaluation results with interpretation, and the defects found and fixed |
| [`docs/PRD.md`](docs/PRD.md) | Product requirements, data model, acceptance criteria |
| [`docs/COMPETITIVE_ANALYSIS.md`](docs/COMPETITIVE_ANALYSIS.md) | Methodology compared against Flo, Clue, Phendo, Bearable and Guava, with the divergences measured |
| [`docs/PRIVACY.md`](docs/PRIVACY.md) | Privacy and ethics position: what's true now, what's deferred and why, how the demo data is generated |

## Headline results

On 240 labelled synthetic cases where cyclicity is known by construction:

| | Precision | Recall | False patterns reported |
|---|---|---|---|
| MedTrace | **0.977** | 0.649 | **2** |
| Ratio rule, no significance test | 0.856 | **0.908** | 20 |

A plain ratio rule beats us on F1 — and reports ten times as many patterns that are not there. We take that trade because a fabricated finding printed in a document handed to a gynaecologist is worse than a missed one. Recall 0.649 is the price, and the clearest target for future work.

**These are engine-validation results on synthetic data.** They say nothing about clinical utility, diagnostic delay, or patient outcomes, which would require prospective clinical evaluation. Limitations are enumerated in [`BUILDLOG.md`](BUILDLOG.md) §B7.

## Status

Prototype. No authentication, encryption, sync, consent or audit layer — all deferred and none pretended. It stores state in `localStorage` and must never hold real patient data.

## Stack

React · TypeScript · Vite · Tailwind · Zustand · Vitest. Charts are hand-built SVG; the chart palette was validated for colour-vision deficiency at all pairs in both light and dark modes.
