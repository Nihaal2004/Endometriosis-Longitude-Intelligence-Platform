# Free-text symptom extraction

**Status:** implemented, `src/engine/nlp.ts` + `src/engine/nlpLexicon.ts`, 18 tests in
`src/engine/nlp.test.ts`. Wired into the Today screen behind an optional "describe
today in your own words" field.

This is Modules 1–3 of the original proposal (Patient Input → NLP Extraction →
Clinical Normalization): a patient narrative goes in, structured symptom observations
come out, and — per the proposal's own worked example (Slide 19) —

> "My periods have been extremely painful lately. I also feel exhausted and sometimes
> get stomach pain when I use the bathroom."

produces severe menstrual pain, fatigue, and a bowel symptom, with menstrual context
and a recent-onset flag. That exact sentence is the first test case in
`nlp.test.ts`, so the claim is pinned by a test, not just a demo that happened to work
once.

## What kind of "NLP" this is, and why

The proposal's own feasibility slide (Slide 20) scopes this precisely: **"rule-based
and statistical processing for core tasks... no model training infrastructure or GPU
cluster required."** Trained diagnostic ML is explicitly out of scope (Slide 12). So
this is not a trained model, and does not pretend to be one:

- **Matching** is clause-level regex co-occurrence against a hand-built lexicon
  (`nlpLexicon.ts`) — e.g. "bathroom"/"toilet" co-occurring with a pain word in the
  same clause routes to dyschezia (`painful_bm`), the same way the proposal's own
  example maps "stomach pain when I use the bathroom" to a bowel symptom rather than
  generic bloating.
- **Severity** is read from an ordered word list ("unbearable" → 9–10, "mild" → 2–3),
  with an explicit neutral default (5) and an asterisk in the UI when no severity word
  was found — the estimate is never presented as if the patient said a number.
- **Negation** is scoped to the clause the symptom cue was found in ("terrible
  cramps, but no nausea" correctly reports both), a deliberately stated limitation
  rather than full dependency parsing.

This mirrors the project's existing design principle for statistics — "no statistics
inside a language model" — applied one layer earlier: no symptom extraction inside an
opaque model either. Every match traces back to the literal clause that produced it,
which is what makes it auditable by the patient before anything is saved, and
defensible to a panel asking "how do you know it got that right."

## The review step (why this satisfies the ethics requirement, not just the technical one)

The proposal's own ethics section (Slide 22) requires: *"Allow the patient to review
the generated summary,"* *"Correct inaccurate entries,"* *"Control shared
information."* The Today screen implements this literally, not just in principle —
extraction never writes to the record directly. It renders a review list under the
text box: each detected symptom is a toggle-able chip with an editable severity
slider and the exact source clause quoted underneath it. Nothing is saved until
`upsertDay` runs, which only reads whatever the patient left toggled on.

An explicit denial ("no nausea today") is saved as `state: 'absent'`, not left
`unknown` — the patient answered the question, just through text instead of a chip,
and the tri-state model (`docs/PRD.md` §5) says an answered question is never
`unknown`.

## Integration

Extraction output feeds into the exact same `DayRecord.symptoms` structure the
existing chip-based UI produces — no change to `features.ts`, `patterns.ts`,
`brief.ts`, or any of their 129 existing tests. The raw narrative is saved on
`DayRecord.note` (a field the type already defined but nothing previously used) for
audit purposes.

## Known limitations, stated rather than hidden

- **Clause-scoped negation, not dependency parsing.** A pathological clause with two
  symptom cues on opposite sides of one negation could misattribute. Covered by a
  test for the common case; not a general solver.
- **English only, and tuned to the phrasing patients used in this project's own
  survey and worked example** — not validated against a broader corpus.
- **`note` is saved but not yet rendered** in the Brief or Timeline screens. The
  proposal's brief structure (Slide 16) calls for a "patient-logged timeline"
  section; this extends the data model to support it but doesn't yet surface the raw
  text anywhere after Today. Flagged as the next piece of this feature, not silently
  dropped.
- **Voice input** (also listed as optional in the proposal) is not implemented.
- **No real patient text has been tested against this lexicon** — same caveat as the
  rest of the prototype (`docs/PRIVACY.md`): everything here is exercised against
  synthetic scenarios and the project's own worked example.

## Extending the lexicon

Each entry in `SYMPTOM_RULES` (`nlpLexicon.ts`) is either a `strong` pattern
(unambiguous on its own) or a `requireAll` co-occurrence (multiple cues must all
appear in the clause), with an optional `unless` to suppress it when a more specific
rule should win instead. Adding a new phrasing is a one-line regex addition to an
existing rule; adding a new symptom is a new rule object, with symptom-level metadata
(graded, sensitive, clinical term) already read from the same `SYMPTOMS` vocabulary
the rest of the app uses — there is no separate list to keep in sync.
