# MedTrace

**A longitudinal symptom-intelligence prototype for endometriosis.**

Endometriosis carries a mean interval of roughly 6.8 years from first symptom to diagnosis. The delay is not caused by an absence of symptoms — it is caused by the absence of structured longitudinal evidence at the moment of consultation. Symptoms accumulate across years; a consultation sees fifteen minutes reconstructed from memory.

MedTrace builds a structured record from very small daily interactions, computes patterns from it deterministically, and renders them as a one-page clinician brief in which **every sentence is traceable to the days that produced it**.

It does not diagnose, does not score risk, does not stage disease, and does not predict cycles.

---

## Run it

**Demo only (no backend):**

```bash
npm install
npm run dev          # open the app, choose a demo patient on the sign-in screen
```

**With accounts, against a local Supabase** (needs Docker):

```bash
supabase start       # prints the API URL and the publishable (anon) key
cp .env.example .env.local   # paste the key into VITE_SUPABASE_ANON_KEY
npm run dev          # register; confirmation emails arrive in Mailpit, http://127.0.0.1:54324
```

**Checks:**

```bash
npm test             # 170 unit tests: statistics, engine, data layer, check-in rules, sharing
npm run test:db      # 46 pgTAP tests: row-level security, history, sharing, erasure
npm run e2e          # end-to-end account flow (27 checks) + phone layout (18 checks)
npm run eval         # regenerate the engine evaluation metrics (~60s)
```

**Android** (Capacitor 8 — needs JDK 21 and the Android SDK):

```bash
npm run android:apk  # web build in "android" mode, cap sync, then gradle assembleDebug
```

The emulator reaches a laptop's local Supabase at `10.0.2.2`; put that in `.env.android.local`. iOS needs a Mac with Xcode, or a cloud build service.

Three demo patients ship with the app, each exercising a different engine behaviour: **Maya** (a clear perimenstrual pattern), **Priya** (persistent pain with a treatment that helped one symptom), and **Aisha** (a sparse record where the engine withholds everything).

## The app

Four tabs, so the daily screen stays a 20-second check-in and the analysis lives one tap away.

| Tab | What it holds |
|---|---|
| **Today** | The cycle ring (tap any day to open its log; page back through earlier cycles) and today's check-in |
| **Calendar** | The month at a glance — bleeding, logged, not logged. Tap any past day to change it |
| **Insights** | The clinician **Report** (share it as an expiring link, or save a PDF), **Patterns**, **Timeline**, and **How it works** (method and validation) |
| **Me** | Profile, reminders, app lock, treatments and appointments, data download, consent, account deletion |

Accounts are email and password (Supabase Auth, PKCE). Every entry is stored on the device first and synced in the background, so logging never waits for a connection.

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

## Headline results

On 240 labelled synthetic cases where cyclicity is known by construction:

| | Precision | Recall | False patterns reported |
|---|---|---|---|
| MedTrace | **0.977** | 0.649 | **2** |
| Ratio rule, no significance test | 0.856 | **0.908** | 20 |

A plain ratio rule beats us on F1 — and reports ten times as many patterns that are not there. We take that trade because a fabricated finding printed in a document handed to a gynaecologist is worse than a missed one. Recall 0.649 is the price, and the clearest target for future work.

**These are engine-validation results on synthetic data.** They say nothing about clinical utility, diagnostic delay, or patient outcomes, which would require prospective clinical evaluation. Limitations are enumerated in [`BUILDLOG.md`](BUILDLOG.md) §B7.

## Status

Built for a small pilot in India; not yet deployed. Accounts, row-level security, offline sync, revision history, per-purpose consent (DPDP Act 2023), audit, selective sharing, data export and erasure all exist and are tested against a local Supabase.

**Before any real patient is enrolled:**

1. Create the Supabase project in **ap-south-1 (Mumbai)** — the region can't be changed later — and run the migration.
2. Configure a custom SMTP provider. Supabase's built-in mailer is for development and allows only a few emails an hour.
3. Add the production web URL and `com.medtrace.app://auth/callback` to Supabase's allowed redirect URLs.
4. Name a real grievance officer in `src/ui/privacy.ts` and finalise the privacy-notice wording.
5. Obtain institutional ethics approval if the pilot is a study.

The app is for adults: DPDP requires verifiable parental consent for anyone under 18, which is not built.

## Stack

React · TypeScript · Vite · Tailwind · Zustand · Dexie · Supabase (Auth, Postgres, RLS) · Capacitor 8 · Vitest · pgTAP · Playwright. Charts are hand-built SVG; the chart palette was validated for colour-vision deficiency at all pairs in both light and dark modes.
