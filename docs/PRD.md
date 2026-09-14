# MedTrace — Product Requirements

**Status:** prototype, v0.1.0 · **Audience:** project team and module evaluators

---

## 1. Problem

Endometriosis affects roughly 190 million people worldwide, and the mean interval from first symptom to confirmed diagnosis is about 6.8 years. That delay is not caused by an absence of symptoms. It is caused by an absence of *structured longitudinal evidence at the moment of consultation*.

Symptoms accumulate across days, cycles, treatments and years. A consultation sees a fifteen-minute snapshot, reconstructed from memory, and typically a different clinician each time. The scoping and systematic reviews of diagnostic delay converge on the same contributors: normalisation of severe pain, attribution to primary dysmenorrhoea, symptom overlap with IBS and urinary conditions, fragmented records across providers, and false reassurance from normal imaging.

**The gap we address:** patient-generated data exists and daily tracking is feasible, but existing tools stop at self-tracking, charts and education. The under-developed step is converting longitudinal, multi-domain, cycle-aware data into a short, traceable, clinician-oriented summary.

## 2. What this product is, and is not

**Is:** a longitudinal health-intelligence system that builds a structured symptom record from very small daily interactions, computes patterns from it deterministically, and renders those patterns as an evidence-traceable consultation brief the patient reviews before sharing.

**Is not**, and must never become:

| Non-goal | Why it is excluded |
|---|---|
| Diagnosis, or a likelihood of endometriosis | Multi-system symptoms are not specific enough to establish diagnosis; the literature is explicit on this. |
| A risk score ("Endometriosis risk: 87%") | Implies a validated model that does not exist. |
| Disease staging from symptoms | Symptom burden and surgical stage are known to correlate poorly. |
| Cycle prediction | A different objective that would push the model toward smoothing and imputation — see `COMPETITIVE_ANALYSIS.md` §2.1. |
| LLM-computed statistics | Numbers must be reproducible and auditable. |
| Automatic clinician access | Sharing is a per-report decision the patient makes. |

## 3. Prototype scope

**In scope (built):** onboarding-free demo personas; adaptive daily check-in at three depths; tri-state observation model; cycle segmentation and phase alignment; the feature and pattern engines; the fidelity checker; the consultation brief with per-sentence evidence; timeline; the validation harness and in-app metrics screen.

**Explicitly deferred (not built, and not pretended):** authentication, encryption at rest, server sync, consent records, audit logs, share grants with expiry, biometric lock, data export and deletion flows, and the offline-first sync layer. These are production requirements; this prototype stores state in `localStorage` and should never hold real patient data.

## 4. Users

| Persona | Situation | What she needs |
|---|---|---|
| **Maya, 24** — suspected | Six months of symptoms, two GP visits, one normal ultrasound, told it is normal period pain. | Evidence that her symptoms cluster and interfere with life, in language a gynaecologist takes seriously. |
| **Priya, 31** — confirmed | Post-laparoscopy, recurrent pain, started on progestin mid-record. | To show what changed after treatment started, on days she cannot otherwise recall. |
| **Aisha, 19** — undiagnosed | Started tracking three weeks ago, logs sporadically. | Not to be told a pattern exists when there isn't enough data to say. |
| **Clinician** | Fifteen minutes, no prior relationship, no access to the app. | One page, patient-reported clearly labelled, with data completeness visible. |

## 5. Data model

Four layers, and the separation between them is what keeps daily burden low:

- **Baseline** — collected once or occasionally. Age range, diagnosis status, symptom onset, family history, prior labels, prior surgery, menstrual baseline. *Not* exact DOB, address, or national ID: the intelligence layer never needs identity.
- **Daily** — collected in seconds. Bleeding, primary pain, functional impact, adaptive symptom chips, medication.
- **Event** — only when something happens. Detailed pain episodes, treatment episodes, healthcare events, investigations.
- **Derived** — never entered. Cycle day, rates, trends, co-occurrence, coverage. See §6.

### The tri-state rule

Every symptom on every day is `present`, `absent`, or `unknown`. There is no default and no fourth state.

```
Monday    pain = 0      → absent, counts in the denominator
Tuesday   no entry      → unknown, counts in nothing
Wednesday pain = 7      → present
```

This is enforced structurally: the feature engine `continue`s on `unknown` before incrementing any counter, and a unit test asserts that adding unlogged days to a record cannot move any computed rate.

## 6. Derived features

Per symptom, per analysis window: observed days, days present, severe days (≥7), median and maximum severity, perimenstrual rate with Wilson CI, non-menstrual rate with Wilson CI, cycles with symptom, impact days, medication days, coverage, and per-cycle rate series.

## 7. Pattern detection — one question, one named test

| Question | Method | Why this one, and what was rejected |
|---|---|---|
| Concentrated around menstruation? | **Fisher's exact** on perimenstrual vs rest-of-cycle 2×2 | Expected cell counts routinely fall below 5 (three cycles give ~18 perimenstrual days), where the χ² approximation is invalid. *Rejected: χ², Pearson correlation with cycle day.* |
| Where does it peak? | **Rayleigh test** on phase angles, as a cross-check | Treats the cycle as a circle, so it has no window boundary and cannot be an artefact of where we drew one. Angles normalise by each cycle's own length. *Rejected: assuming 28 days and binning by calendar day.* |
| Getting worse? | **Mann–Kendall** + **Theil–Sen** slope | Rank-based; assumes monotonicity, not linearity or normality, and resists one extreme cycle out of four. *Rejected: least-squares on 4 points.* |
| Travel together? | **Cohen's κ** with a permutation null | κ discounts chance overlap between two common symptoms; consecutive days are not independent, so the asymptotic variance would be optimistic. *Rejected: raw co-occurrence counts.* |
| Changed from her own baseline? | **Exact conditional Poisson** rate test | A cycle may contribute 3–8 events; normal-approximation two-sample Poisson is unreliable there. *Rejected: comparison against a population average.* |
| How many are spurious? | **Benjamini–Hochberg**, within pattern family | ~19 tests per patient; uncorrected we would expect a false finding in nearly every brief. FDR suits screening; Bonferroni discards too much power. |

### The evidence gate

A finding is reported only if **coverage ≥ 60%**, **≥2 complete cycles in the window**, **≥4 recorded occurrences**, and **q < 0.05**. A finding that fails is *withheld with its reason shown*, never silently dropped — absence of evidence must not read as evidence of absence.

Descriptive findings (persistence rate, functional-impact counts) carry a confidence interval instead of a p-value and are exempt from the significance gate. Their counts are true regardless of whether a trend exists.

## 8. Daily experience

Three depths, patient's choice: **Quick** (~15–20s: pain, bleeding, impact, one symptom), **Standard** (default, ~30–45s: adds symptoms, medication, impact detail), **Detailed episode** (only when something significant happened: location, character, duration, trigger, response).

The adaptive planner decides what appears: frequency, dormancy (a symptom unreported across 45 observed days leaves the daily list), and cycle phase (phase-linked symptoms surface during their window). Two safeguards: **nothing is ever removed from the vocabulary**, and **a question not asked is recorded as `unknown`, never `absent`** — question reduction must not manufacture negative observations.

Measured: 6.8 fields per day against 37 for a fixed questionnaire covering the same vocabulary, an 81.5% reduction.

## 9. The brief

**Generation.** Findings → typed `Claim` objects → templated sentences. The `assertedValues` field lists exactly the numbers appearing in the prose. No number is authored by a language model.

**Verification.** `fidelity.ts` re-derives every asserted value from the raw day records via a deliberately separate implementation — its own onset scan, its own window rule, its own counting loops. Disagreement drops the claim. The duplication *is* the mechanism: a checker reusing the feature layer would reproduce its bugs and verify nothing.

**Optional LLM polish.** If enabled, a model may rephrase but not renumber: every numeric token in the rewrite must already exist in the claim, or the deterministic original is used.

**Contents.** Recorded period and coverage · main concerns · longitudinal findings · functional impact · medication · change from baseline · clinical timeline · data quality · a fixed non-diagnostic statement. Every sentence opens its evidence on click.

## 10. Acceptance criteria

1. A patient completing a standard check-in is presented with ≤8 fields.
2. Adding unlogged days to a record changes no computed rate.
3. Every sentence in the brief opens an evidence drawer naming its test and contributing days.
4. Every number in the brief is independently re-derived before render; failures are dropped and counted.
5. A record below the coverage floor yields *withheld* findings with reasons, not weak findings.
6. The brief contains no diagnostic language (asserted by a test over a forbidden-phrase list).
7. The engine is deterministic: identical input yields byte-identical findings.
8. Nothing under `src/engine/` imports React or anything from `src/ui/`.

## 11. Evaluation

Because the literature supports the *rationale* far more strongly than any outcome claim, evaluation targets intermediate properties only: detection accuracy against known ground truth, robustness to missingness, brief fidelity and mutation-catch rate, logging burden, and latency. Results and their limits are in `BUILDLOG.md`.

**No claim is made about diagnostic delay, referral decisions, or patient outcomes.** Those require prospective clinical evaluation, and the product's language is constrained accordingly.
