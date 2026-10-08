# Historical research comparison

This comparison preserves the original project research and synthetic engine
evaluation. Competitor descriptions have not been reverified for this release.
For current implemented features, see [PRD.md](PRD.md).

**Purpose.** This document exists to answer one question a reviewer will reasonably ask: *symptom trackers already exist, so what is actually different here?* Every difference claimed below is a difference we implemented and, where possible, measured — not a positioning statement.

---

## 1. The comparison set

| Product | What it is | Primary optimisation target |
|---|---|---|
| **Flo** | The largest consumer menstrual-health app. Cycle prediction, symptom logging, AI symptom checkers, educational content. | Prediction accuracy and daily engagement at very large scale. |
| **Clue** | Science-forward cycle tracker with explicit endometriosis symptom-tracking guidance and a research arm. | Accurate cycle characterisation and editorial credibility. |
| **Phendo** (Citizen Endo, Columbia DBMI) | Endometriosis-specific *research* app, co-designed with over 1,000 patients; the basis for published phenotyping work on self-tracked endo data. | Research-grade characterisation of the disease across a cohort. |
| **Bearable** | General chronic-illness tracker: symptoms, factors, medication, mood, with correlation views. | Breadth across conditions; personal self-experimentation. |
| **Guava Health** | Aggregates medical records plus self-tracked data and generates visit summaries. | Consolidating records ahead of an appointment. |

Two systematic reviews of the app landscape (Anastasiu-Popov et al. 2025; the mHealth quality review 2025) reach the same conclusion from the outside: many endometriosis-relevant trackers exist, but few use validated symptom definitions, and **few produce any output designed for a clinical consultation rather than for the user's own dashboard.**

That is the gap this project targets. Phendo is the closest precedent scientifically — but its analytical output serves researchers studying a cohort, not the individual patient walking into a fifteen-minute gynaecology appointment.

---

## 2. Four methodological divergences

These are stated as *methodology*, because each one changes the mathematics, not just the interface.

### 2.1 The cycle model: retrospective alignment, never prediction

Flo and Clue exist substantially to tell you when your next period is due. That objective has a consequence most users never see: a predictor is rewarded for *smoothing*. Irregular cycles get regularised toward a personal mean, and gaps get filled, because an unsmoothed predictor performs worse.

MedTrace never predicts a cycle. It segments cycles from recorded bleeding onsets only, keeps each cycle's own observed length, and positions every symptom day relative to the nearest onset (`D−2`, `D0`, `D+3`). A cycle whose end has not yet happened is marked incomplete and contributes no length to anything.

*Why it matters here:* endometriosis populations have genuinely irregular cycles, and irregularity is itself clinical signal. A model that smooths it away destroys the variable of interest. Concretely, `cycles.ts` derives a phase angle as `2π · dayInCycle / thisCycleLength`, so a 24-day and a 34-day cycle are comparable without either being coerced toward 28.

*Adopted from them:* nothing to improve on in Clue's cycle-characterisation UX; our ring borrows its directness.

### 2.2 Missing data: three states, not two

In a calendar-grid tracker, a day you did not log and a day on which you had no symptoms look identical — an empty cell. Streak mechanics compound this by making gaps feel like personal failures rather than data properties.

MedTrace stores `present | absent | unknown` and **excludes `unknown` from every denominator in the system**. A day you skipped contributes to nothing. Coverage is reported alongside every finding, and a finding below the coverage floor is withheld with a stated reason rather than silently omitted.

*Why it matters here:* this is not a purity argument, it is the dominant bias in self-tracked symptom data. People log differently on bad days. We measured the cost directly — see §3.

*Consequence in the product:* there are no streaks, no guilt copy, and the daily check-in tells you which questions it skipped and why.

### 2.3 The analytical layer: named tests, effect sizes, and multiplicity control

Consumer trackers surface descriptive "insights" — *you tend to feel bloated around your period* — computed from counts, with no test statistic, no confidence interval, and no correction for the fact that dozens of such comparisons are being made. Phendo's published analyses are genuinely statistical, but they characterise a cohort retrospectively rather than gating what an individual's app is allowed to tell her.

MedTrace answers each clinical question with one named test, reports an effect size with a confidence interval, corrects for multiplicity, and **refuses to render a finding that fails the gate**.

| Question | Test | Effect size |
|---|---|---|
| Concentrated around menstruation? | Fisher's exact (2×2) | Risk ratio + Katz CI |
| Where does it peak, without a window edge? | Rayleigh test on phase angles | Mean resultant length R̄ |
| Getting worse? | Mann–Kendall | Theil–Sen slope |
| Which symptoms travel together? | Permutation test on Cohen's κ | κ |
| Changed from her own baseline? | Exact conditional Poisson | Rate ratio |
| How many of these are spurious? | Benjamini–Hochberg within family | q-value |

Each choice is defended against the obvious alternative in `docs/PRD.md` §7 and on the app's own Method screen.

### 2.4 The output: a traceable clinician brief, not a dashboard

Every product above terminates in a view the patient looks at. MedTrace terminates in a **one-page document a clinician reads**, in which every sentence is click-traceable to the derived feature, the test, and the individual days behind it.

The numbers in that document are never written by a language model. Sentences are rendered from templates whose numeric slots are filled from computed findings, and a fidelity checker then re-derives every asserted number from the raw records through a *separately written* implementation before the sentence is allowed to render.

*Why it matters here:* the patient-generated-health-data literature is unambiguous that such data can *increase* clinician workload when it arrives long, unprioritised, or untrustworthy. A brief that cannot be checked is worse than no brief.

---

## 3. What the divergences cost and buy, measured

We implemented the two obvious ablations and scored all three on identical synthetic cohorts where cyclicity is known by construction (full method and tables in `BUILDLOG.md`).

| Classifier | Precision | Recall | F1 | False patterns reported |
|---|---|---|---|---|
| MedTrace (full engine) | **0.977** | 0.649 | 0.780 | **2** |
| Ratio rule, no significance test | 0.856 | **0.908** | **0.881** | 20 |
| Ratio rule + missing-as-zero | 0.850 | 0.908 | 0.878 | 21 |

**Read this honestly: on F1, the simple ratio rule beats us.** It finds more real patterns precisely because it tests nothing. What it also does is report ten times as many patterns that are not there.

We accept that trade because the two errors are not symmetric in this setting. A missed pattern leaves a patient where she already was. A fabricated pattern is printed in a document she hands to a gynaecologist, where it is typographically indistinguishable from a real finding — and the entire premise of the product is that this document should be more trustworthy than her recollection, not less. Recall of 0.649 is the price, and it is the single clearest target for future work.

The zero-imputation ablation is worth a separate note: at 10% missingness it is barely distinguishable from the tri-state version, because when almost everything is logged the distinction hardly bites. Its cost appears as coverage falls — precision degrades to 0.75 at 41% coverage where the tri-state engine holds at 1.00. The honest summary is that **missing-as-zero is a latent bug that only detonates on the sparse records real users actually produce.**

---

## 4. What we deliberately adopted

Divergence is not the goal; the following are straightforwardly better in the incumbents and are reproduced here.

- **Clue's chip-based logging and editorial restraint.** Low-friction taps, no cartoon language, real typography.
- **Flo's progressive onboarding and question reduction.** Do not ask a hundred questions on day one. Our adaptive planner extends this: symptoms never reported go dormant, phase-linked symptoms surface during their window, and the full vocabulary stays reachable at all times.
- **Phendo's multi-domain taxonomy and patient-defined vocabulary.** Pain, bowel, urinary, systemic, sexual and extrapelvic domains, with the patient's own wording retained alongside the clinical term (she sees "pain opening bowels", the brief says "dyschezia").
- **Guava's insight that the appointment is the moment that matters.** We differ on how the summary is produced, not on the premise that producing one is the point.

---

## 5. Honest limits of this comparison

- Competitor behaviour is characterised from public documentation, the published app-review literature, and observable product behaviour — **not** from their source code. Claims here are about design orientation, not internal implementation.
- App features and privacy practices change quickly; the reviews cited were conducted in 2025 and may already be partly stale.
- Our measured comparison in §3 scores *our reimplementation* of a ratio-rule baseline, not Flo's or Clue's actual algorithms, which are not public. It isolates the contribution of a design decision; it is not a benchmark against a named product, and should never be presented as one.
- MedTrace has not been used by a single real patient or read by a single clinician. Everything above concerns how the system computes, not whether anyone finds it useful.

---

### References

1. Understanding diagnostic delay for endometriosis: a scoping review (2025)
2. Factors contributing to delayed diagnosis of endometriosis: a systematic review (2025)
3. Patient-Reported Outcome Measures in Endometriosis (2021) — PMC8585017
4. A systematic literature review on patient-reported outcome domains in endometriosis (2024) — PMC11474936
5. Developing a set of patient-centered outcomes for routine use in endometriosis care (2023) — PMC10755132
6. ENDOPAIN-4D validation study (2021) — PMC8348422
7. Endometriosis Symptom Diary (ESD) and Endometriosis Impact Scale (EIS) (2020) — PMC7028881
8. Symptom tracking for endometriosis: a systematic review of mobile applications (2025) — PMC12519716
9. Good-Quality mHealth Apps for Endometriosis Care (2025) — PMC11845897
10. Symptom tracking in endometriosis using digital technologies (2023) — ScienceDirect S2666379123003592
11. Patient Generated Health Data Use in Clinical Practice (2019) — PMC6697140
12. Phenotyping Endometriosis through Mixed Membership Models of Self-Tracking Data — arXiv:1811.03431
