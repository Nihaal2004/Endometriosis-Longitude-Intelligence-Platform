# Privacy & Ethics

**Status:** prototype, v0.1.0. This document is the single place that states our privacy
and ethics position — previously scattered as caveats across `README.md`, `PRD.md` and
`BUILDLOG.md`. It exists because Review 2 asked directly how we plan to handle
privacy and ethical data concerns, and that deserves a direct answer rather than a
footnote.

---

## 1. Why this matters more than for a typical tracker

Endometriosis symptom data is not generic health data. It routinely includes:

- **Sexual and reproductive information** (dyspareunia, avoided intimacy) — data
  that can be used to out, stigmatise, or discriminate against someone if it leaks.
- **Fertility and reproductive-history signal** (cycle regularity, prior surgery,
  treatment response) — in some jurisdictions this category carries legal
  sensitivity around insurance, employment, and reproductive-rights exposure.
- **A population already experiencing diagnostic dismissal.** Several of our own
  demo personas (`src/data/personas.ts`) encode exactly this: normal imaging,
  reassurance, symptoms not believed. A tool built for that population loses its
  entire premise if its own data handling repeats the pattern of not being taken
  seriously.

This is the reasoning behind every design choice below — not just "we'll add
security later," but which specific harms we are designing against.

## 2. What is true right now (prototype state)

| Property | State | Where enforced |
|---|---|---|
| Real patient data | **Never collected.** All three demo patients (Maya, Priya, Aisha) are synthetically generated from a seeded statistical process — see §4 below and `src/data/generator.ts`. | By construction — there is no data-entry path that reaches a backend; there is no backend. |
| Storage | Browser `localStorage` only, on the device the app runs on. Nothing leaves the device. | No network calls exist in `src/` outside the optional LLM-polish path, which sends only already-computed, already-verified claim text — never raw day records. |
| Identity | No exact date of birth, address, or national ID is in the data model at all — not encrypted, not collected. | `PRD.md` §5: baseline profile uses `ageRange`, not DOB. |
| Sensitive-domain fields | Sexual-domain symptoms (`dyspareunia`, `post_coital_pain`, `intimacy_avoidance`) are marked `sensitive: true` in `src/engine/symptoms.ts` and are structurally excluded from the adaptive daily suggestion list (`adaptive.ts:108`) — they only appear if the patient explicitly opts in via "add another symptom," never by default. | `src/engine/adaptive.ts`, `src/engine/symptoms.ts` |
| Sharing | Nothing is transmitted automatically. The brief is a document the patient would choose to show or export — there is no clinician account, no auto-sync, no third party with access. | Architecture — no such integration exists. |

## 3. What is explicitly deferred, and why that's an honest position rather than a gap being hidden

A prototype whose job is to validate an *analytical method* (do the statistics correctly
detect real patterns?) does not need a production security stack to answer that
question, and building one prematurely would spend review-cycle time on infrastructure
instead of on the thing actually being evaluated: whether the engine's findings are
trustworthy. So the following are **deferred, not skipped**:

| Deferred | Required before any real patient data | Rough sequencing |
|---|---|---|
| Authentication | Yes — before any account exists | 1st |
| Encryption at rest | Yes — before any data leaves `localStorage`-only mode | 1st (alongside auth) |
| Consent records (what was agreed to, when, versioned) | Yes — before first real data entry | 2nd |
| Server sync / backend | Yes — only once auth + encryption exist | 2nd |
| Audit log (who viewed what, when) | Yes — before any clinician-facing sharing | 3rd |
| Share grants with expiry (a brief link that expires, not a standing account) | Yes — this is how "sharing is a per-report decision" (PRD §2) becomes real rather than aspirational | 3rd |
| Data export & deletion (right to be forgotten) | Yes — regulatory requirement in most jurisdictions handling health data | 3rd |

**The guardrail that makes deferral safe:** every document that describes this
prototype — `README.md`, `PRD.md`, `BUILDLOG.md` — states plainly that it "must never
hold real patient data" in its current form. That sentence is the actual safeguard
right now, and it is backed by there being no code path that would accept real
patient input even if someone tried (no auth means no session to attach real identity
to; no backend means there's nowhere for it to go).

## 4. How the data actually used in the demo is made

None of it is real. All three personas and every evaluation cohort come from
`src/data/generator.ts`, a **generative statistical model**, not recorded, scraped, or
anonymised real data:

1. **Cycles are generated first** — length drawn from a clipped normal distribution
   (21–45 days, realistic bounds), bleed duration similarly, seeded per patient.
2. **Each symptom is given a generating process**, not a lookup table: a base
   occurrence rate plus, for symptoms meant to be cyclical, a von Mises
   (circular-normal) distribution over cycle phase. Non-cyclical symptoms use the
   *same distribution's average* as a constant, so cyclical and non-cyclical symptoms
   have matched marginal prevalence — the only thing distinguishing them is *when*
   in the cycle they occur, not how often. This exists specifically so the pattern
   engine can't score well by exploiting frequency instead of genuinely detecting
   phase-concentration.
3. **A ground-truth label is written down for every symptom** at generation time
   (`cyclical: true/false`, concentration, drift) — and a unit test asserts the
   pattern engine never reads this label, only the simulated day-to-day
   observations, exactly as a real deployment would have no ground truth to
   cheat from.
4. **Missingness is layered on last**, either at random (MCAR) or adversarially —
   the worse the day, the more likely it's unlogged (MAR) — to mimic the real bias
   that people log less on their worst days.
5. **Everything is seeded** (`seed: 'persona:maya:v1'`, etc.), so regenerating a
   persona produces byte-identical output — the demo you see tomorrow is
   reproducible, not hand-picked from a lucky run.

This lets us report detection accuracy against a *known* answer (§B1–B3 of
`BUILDLOG.md`), which is not possible with real self-reported symptom data — nobody
independently knows whether a real patient's bowel pain is "truly" cyclical, so real
data has no ground truth to score against even if we had ethics approval to collect it,
which we do not, and are not seeking at this stage.

## 5. What a panel question here should get as an answer

- *"Is any of this real patient data?"* — No. Everything is synthetically generated
  with known ground truth, specifically so detection accuracy can be measured against
  an answer nobody has to guess at.
- *"What happens if this became a real product tomorrow?"* — Nothing does, until
  §3's list is built, in the stated order, starting with auth and encryption.
- *"Why is sexual-health data a separate concern here?"* — because it's already
  structurally separated in the code (`sensitive: true`, opt-in only, never
  auto-suggested) — a technical control, not just a policy statement.
- *"How would you actually get consent from someone in this much pain to track
  this much detail?"* — open question, correctly flagged as future work; the
  adaptive planner's whole design (≤8 fields/day, §PRD 8) exists partly *because*
  burden and consent-to-continue are linked — a tool nobody keeps using has
  effectively revoked consent through disuse.
