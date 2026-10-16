# MedTrace metrics, explained

Every number MedTrace computes or reports, what it means, and why it is used. No statistics background is assumed.

There are four groups:

1. [Numbers in the report](#1-numbers-in-the-report): what the patient and doctor read.
2. [Statistics behind the report](#2-statistics-behind-the-report): what decides whether a pattern is real. Never printed in the report.
3. [Evaluation metrics](#3-evaluation-metrics): how well the engine was tested (precision, recall, F1 and so on). For developers and reviewers only.
4. [Medical-term suggestion accuracy](#4-medical-term-suggestion-accuracy): how well the AI wording feature was tested.

> **Why the report has no p-values or F1 scores.** A doctor or patient needs to know *what happened and how often*, not which test was used. Statistical detail stays inside the engine; the report says it in words ("unlikely to be chance"). Evaluation metrics such as F1 describe the *software*, not the *patient*, so they never appear in a report at all.

---

## 1. Numbers in the report

| What you see | What it means | Example |
|---|---|---|
| **"X of Y logged days"** | X days had the symptom, out of Y days where the patient said whether it happened. Days with no entry are not counted. | "12 of 17 logged days around the period" |
| **Percentage** | X divided by Y, rounded. | 12 / 17 = 71% |
| **"Around the period"** | The 6 days from 2 days before bleeding starts to 3 days after. Fixed for everyone, never tuned. | |
| **"At other times" / "away from the period"** | Every other logged day in the cycle. | |
| **"About N times as often"** | The percentage around the period divided by the percentage at other times. 1 means no difference. | 71% / 15% ≈ 4.8 |
| **"Most common about N days before bleeding started"** | The day, relative to the first day of bleeding, when the symptom was recorded most often. | |
| **"Became more frequent over N cycles"** | The share of days with the symptom in the first cycle compared with the most recent. | "20% of days in the first cycle and 45% in the most recent" |
| **"Tended to happen on the same days"** | Two symptoms appeared together more often than they would by coincidence. | "both on 31 of 80 days" |
| **"Higher than across the previous N cycles"** | The latest full cycle compared with the patient's own earlier cycles, not with other people. | |
| **"N of M days have an entry (P% of days logged)"** | Coverage: how much of the period was logged. Low coverage means less reliable patterns. | "90 of 100 days (90%)" |
| **"N complete cycles, usually M days long"** | Cycles are counted from logged bleeding. "Usually" is the median length (the middle value), with the shortest and longest. | |
| **"Rated 7 or more out of 10"** | A severe day. A reporting convention, not a medical cut-off. | |

### The one rule behind every number

**A day with no entry is unknown, not symptom-free.** If the patient didn't log Tuesday, Tuesday is left out of both the top and bottom of every fraction. Many trackers count a blank day as "no symptoms", which makes symptoms look rarer than they are, especially because people tend to skip logging on bad days.

### When is a pattern shown?

A pattern only appears in the report if **all** of these are true:

| Requirement | Value | Plain reason |
|---|---|---|
| Coverage | at least 60% of days logged | With too many gaps, the logged days may not be typical. |
| Complete cycles | at least 2 | Once is an episode; twice is a pattern. |
| Logged days | at least 21 | Too few days make any percentage meaningless. |
| Occurrences | at least 4 | With fewer, one extra day could flip the result. |
| Chance check | passes (q < 0.05, see below) | The pattern is unlikely to be a coincidence. |

Patterns that fail are listed as "not enough data yet", never silently dropped.

---

## 2. Statistics behind the report

These run on the phone, in [src/engine/stats.ts](../src/engine/stats.ts) and [src/engine/patterns.ts](../src/engine/patterns.ts). Each one answers a single question. The data is small (a few cycles), mostly zeros, and rated 0 to 10, so every method was chosen to work on that kind of data.

### p-value

The chance of seeing a pattern at least this strong **if there were really no pattern**. A p-value of 0.01 means "if this symptom had nothing to do with the period, a result like this would turn up about 1 time in 100". Small is good evidence; it is **not** the chance the pattern is real.

### q-value (Benjamini-Hochberg false discovery rate)

MedTrace runs about 19 tests per patient. If you run 19 tests at the usual 0.05 level, you expect roughly one false alarm by luck alone. The **Benjamini-Hochberg** method adjusts each p-value into a q-value so that, among the patterns shown, no more than about 5% are expected to be false alarms. A pattern needs **q < 0.05**.

Correction is done **per family** (all period-link tests together, all trend tests together, and so on). Correcting everything at once was tested and let weak tests hide genuine period-linked findings.

### Fisher's exact test: "Is this symptom tied to the period?"

Puts the days into a 2×2 table:

| | Symptom | No symptom |
|---|---|---|
| Around the period | 12 | 5 |
| Other times | 10 | 58 |

and calculates exactly how unusual that split is if timing didn't matter. Used instead of the chi-square test because it stays correct with small counts (three cycles give only about 18 days around the period).

### Risk ratio: "How much more often?"

The rate around the period divided by the rate at other times. This is the "about N times as often" in the report. Its uncertainty range uses the **Katz log method**; if a cell is zero, the **Haldane-Anscombe correction** adds 0.5 to every cell so the ratio stays finite. Chosen over the odds ratio, which exaggerates effects when symptoms are common.

### Wilson score interval: "How sure are we about this percentage?"

A 95% confidence interval for a proportion: the range the true rate probably lies in. "8 of 10 days" could easily be anywhere from about 49% to 94%. Wilson stays sensible with small numbers and never goes below 0% or above 100%, unlike the simpler Wald interval.

### Rayleigh test and mean resultant length (R̄): "Does it cluster at one point in the cycle?"

Each logged day is placed on a circle by where it falls in **that** cycle (day 7 of a 28-day cycle is a quarter turn). If symptom days bunch together on the circle, there's a cyclical pattern. **R̄** runs from 0 (spread evenly round the cycle) to 1 (always on the same day). The Rayleigh test gives a p-value for that clustering. Used as a cross-check that doesn't depend on where the 6-day window was drawn, and it never assumes a 28-day cycle.

### Mann-Kendall test and Theil-Sen slope: "Is it getting worse or better?"

Mann-Kendall looks at every pair of cycles and asks whether later ones are mostly higher (or lower) than earlier ones. It only uses the ordering, so one unusual cycle can't drive the result. **Theil-Sen** gives the size of the change per cycle: the median of the slopes between every pair of cycles. Chosen over a straight-line regression, where one extreme cycle out of four would decide the answer.

### Cohen's kappa (κ) with a permutation test: "Do two symptoms happen together?"

Two common symptoms overlap a lot just by chance (two symptoms each on 80% of days share about 64% of days for no reason). **Kappa** measures agreement *beyond* that chance overlap: 0 means no more than chance, 1 means always together. A **Jaccard index** (days with both ÷ days with either) is computed alongside as a simple description.

The **permutation test** checks kappa by shuffling one symptom's days 2,000 times and seeing how often a shuffled version agrees as well as the real one. Shuffling is used because consecutive days are related, which makes the textbook formula over-confident. A fixed random seed (`medtrace-permutation-v1`) means the same data always gives the same report.

### Exact Poisson rate comparison: "Is this cycle different from her usual?"

Compares the number of symptom days in the latest cycle with the earlier cycles, allowing for how many days were logged in each. Done exactly (through a binomial test) because one cycle may hold only 3 to 8 symptom days, where approximate tests are unreliable. The comparison is always **with the patient's own past**, never a population average.

### Median and quantiles

The median is the middle value when sorted; it is used for cycle length and severity because a single unusual value doesn't shift it the way it shifts an average.

---

## 3. Evaluation metrics

These describe **how well the software works**, measured on synthetic patients where the right answer is known. They are produced by `npm run eval` into [src/eval/results/metrics.json](../src/eval/results/metrics.json). They say nothing about clinical benefit; that needs a clinical study.

### The four outcomes

Each test case is one symptom for one synthetic patient, labelled as truly period-linked or not. The engine either reports it or doesn't:

| | Engine reports it | Engine stays silent |
|---|---|---|
| **Truly period-linked** | True positive (TP) | False negative (FN): a missed pattern |
| **Not period-linked** | False positive (FP): an invented pattern | True negative (TN) |

### Metrics built from them

| Metric | Formula | Plain meaning | MedTrace result |
|---|---|---|---|
| **Precision** | TP / (TP + FP) | When the report says there's a pattern, how often it's right. | **0.977** (2 false out of 87 reported) |
| **Recall** (sensitivity) | TP / (TP + FN) | Of the real patterns, how many were found. | 0.649 (about 1 in 3 missed) |
| **Specificity** | TN / (TN + FP) | Of the non-patterns, how many were correctly left out. | 0.97 to 1.00 |
| **F1 score** | 2 × precision × recall / (precision + recall) | One number balancing precision and recall. High only when both are high. | 0.780 |
| **MCC** (Matthews correlation coefficient) | (TP×TN − FP×FN) / √((TP+FP)(TP+FN)(TN+FP)(TN+FN)) | Overall quality from −1 (always wrong) through 0 (coin toss) to 1 (perfect). Fair even when one outcome is much more common than the other. | 0.653 |
| **Accuracy** | (TP + TN) / all | Share of all cases decided correctly. Reported but not relied on, because it can look good when one outcome dominates. | |

**Why MedTrace accepts a lower F1.** A simple "ratio rule" with no significance test scores a higher F1 (0.881) and finds more real patterns, but invents **20 false patterns against MedTrace's 2**. A missed pattern leaves the patient where they started; a false one is printed in a document a gynaecologist will read. So MedTrace is tuned for **precision**, and the cost is recall.

### Other evaluation measures

| Measure | What it means | Result |
|---|---|---|
| **κ (generator concentration)** | In the test data, how tightly symptoms cluster around the period. 0 = not at all; higher = tighter. The dial used to test detection power. Different from Cohen's kappa above. | Recall rises from 0.01 at κ = 0 to 0.85 at κ = 6, while specificity stays 0.97 to 1.00 |
| **Coverage** | Share of days logged. Tested from 100% down to 41%, with random gaps and with "bad days skipped" gaps. | Below 60% the gate reports nothing, by design |
| **Claims verified** | Share of report sentences whose every number was recomputed independently and matched. | 256 of 256 (100%) |
| **Values re-derived** | Share of numbers in claims that the checker recomputes from raw days. The rest are test statistics computed from those confirmed counts. | 76.6% |
| **Mutation catch rate** | One number per claim was deliberately corrupted; the share the checker rejected. This proves the 100% above isn't a checker that always says yes. | 224 of 224 (100%) |
| **Fields per day** | Questions answered per check-in. | 6.8 adaptive vs 37 for a full fixed questionnaire (81.5% fewer) |
| **Estimated time** | Fields × 3.5 seconds, an assumption, not measured on real users. | 24 s vs 130 s |
| **Latency (median / 95th percentile / max)** | Time for the full analysis on a 180-day record. The 95th percentile is the time 95% of runs finish within. | 92 / 110 / 115 ms |

Full tables and limitations: [GUIDE.md Part 4](GUIDE.md#part-4-how-well-it-works).

---

## 4. Medical-term suggestion accuracy

The "Describe it in your own words" feature uses MedGemma 4B to suggest a clinical term. It was checked by hand, not scored automatically:

| Test set | Result |
|---|---|
| Development set (13 phrases, some instruction examples came from fixing these) | 12 correct, 1 near miss |
| Unseen phrases (12) | **About 10 of 12 acceptable**; "spots break out" → *Hives* and "dizzy when standing" → *Vertigo* were wrong |
| Diagnoses (e.g. *Depression*) | Always blocked; the patient keeps their own words |
| Instructions hidden in the input | Ignored (no suggestion) |
| Time per suggestion | About 9 seconds on a laptop CPU |

Because a 4B model makes mistakes, every suggestion is shown to the patient first and nothing is saved unless they choose it. Details: [GUIDE.md Part 5](GUIDE.md#part-5-medical-term-suggestions).
