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
| Real patient data | Nothing prevents a real user from typing their own symptoms into "My record" (`src/data/myRecord.ts`) — that mode exists precisely so this is a working tool, not just a demo. The three named personas (Maya, Priya, Aisha) remain synthetic, generated from a seeded statistical process — see §5 below. | The distinction is structural and visible in the UI: "My record" and "Demo patients (synthetic)" are separate, clearly labelled controls (`App.tsx`), never merged. |
| **Encryption at rest** | **Implemented, not deferred.** Everything persisted — the day-by-day record, free-text narratives, baseline profile — is encrypted with AES-GCM-256 before it touches `localStorage`. The key is derived from a passphrase via PBKDF2 (SHA-256, 200,000 iterations) that the user sets on first use. | `src/ui/crypto.ts` (7 tests, `crypto.test.ts`), wired into the zustand store's persistence in `src/ui/store.ts`. |
| **App lock** | **Implemented.** The whole app is gated behind `Lock.tsx` until the correct passphrase is supplied — nothing in the store is readable or writable before that. A wrong passphrase is rejected (AES-GCM's authentication tag fails to verify) rather than silently returning garbage. | `src/ui/Lock.tsx` |
| **Data deletion** | **Implemented for the real record.** "Delete my data" (visible in the persona switcher while on "My record") and "Forgot your passcode?" on the lock screen both permanently erase what's stored on the device — there is no soft-delete, no recovery, by design. | `App.tsx` (`deleteMyRecord`), `Lock.tsx` (`resetDevice`) |
| Storage location | Still browser `localStorage` only, on the device the app runs on — now encrypted, but still never leaves the device. | No network calls exist in `src/` outside the optional LLM-polish path, which sends only already-computed, already-verified claim text — never raw day records. |
| Identity | No exact date of birth, address, or national ID is in the data model at all. | `PRD.md` §5: baseline profile uses `ageRange`, not DOB. |
| Sensitive-domain fields | Sexual-domain symptoms (`dyspareunia`, `post_coital_pain`, `intimacy_avoidance`) are marked `sensitive: true` in `src/engine/symptoms.ts` and are structurally excluded from the adaptive daily suggestion list (`adaptive.ts:108`) — they only appear if the patient explicitly opts in via "add another symptom," never by default. | `src/engine/adaptive.ts`, `src/engine/symptoms.ts` |
| Sharing | Nothing is transmitted automatically. The brief is a document the patient would choose to show, print or export — there is no clinician account, no auto-sync, no third party with access. | Architecture — no such integration exists. |

## 3. The honest limit of the encryption model

This is real client-side encryption, not a promise of it — but it is *client-side*
encryption, and that has a specific, stated ceiling:

- **The passphrase has no recovery path, by design.** It is never written to disk in
  any form — not hashed, not as a hint. Forgetting it means the local data is
  genuinely unrecoverable. This is the same property that makes a stolen device
  useless to an attacker without the passphrase; there is no middle ground where both
  "recoverable if forgotten" and "useless if stolen" are true at once without a
  server to hold a recovery key, which this prototype does not have.
- **It protects the data at rest on this device — not the running app.** While the
  app is open and unlocked, symptom data exists in memory and in the DOM, same as any
  client-side app. This is encryption against a stolen or inspected *device*, not
  against someone reading over your shoulder while it's open.
- **There is exactly one user per device-passphrase pair.** There is no concept of
  multiple accounts, multi-device sync, or a clinician holding their own key — those
  remain genuinely deferred (§4).

## 4. What is still explicitly deferred, and why

The items below are still not built, honestly, because they require a server this
prototype does not have and should not grow prematurely — encryption and app-lock
did not require one, so they moved out of this list; these do:

| Deferred | Required before any real patient data leaves this device | Rough sequencing |
|---|---|---|
| Multi-device sync / backend account | Yes — a server is required by definition | 1st |
| Consent records (what was agreed to, when, versioned) | Yes — before any data leaves a single device | 1st |
| Audit log (who viewed what, when) | Yes — before any clinician-facing sharing | 2nd |
| Share grants with expiry (a brief link that expires, not a standing account) | Yes — this is how "sharing is a per-report decision" (PRD §2) becomes real rather than aspirational | 2nd |
| Biometric unlock (as an alternative to the passphrase) | No — usability improvement, not a safety requirement | 3rd |
| Server-side data export in a portable format | Yes, once sync exists — locally, "Delete my data" and the Brief's PDF export already cover the single-device case | 3rd |

**The guardrail that still applies:** the app never transmits day-record data anywhere
— there is no backend to receive it even if the UI tried. What changed is that the
*local* copy is no longer a plaintext promise-to-secure-later; it is actually
encrypted, today.

## 5. How the *demo* data is made — separately from anything a real user enters

None of the three named personas is real. Maya, Priya and Aisha, and every evaluation
cohort, come from `src/data/generator.ts`, a **generative statistical model**, not
recorded, scraped, or anonymised real data. "My record" (§2) is the opposite of this
by construction — it starts with zero days and contains only what a real user actually
logs, encrypted the same way regardless of whether that user is one of this team
demoing to a panel or someone using the app for themselves.

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

## 6. What a panel question here should get as an answer

- *"Is any of the Maya/Priya/Aisha data real patient data?"* — No. Synthetically
  generated with known ground truth, specifically so detection accuracy can be
  measured against an answer nobody has to guess at.
- *"Is data encrypted, or is that still a promise?"* — Implemented: AES-GCM-256, key
  derived via PBKDF2 from a user-set passphrase, 7 passing tests including that a
  wrong passphrase is rejected and that identical plaintext never produces identical
  ciphertext twice. Demonstrable live — the lock screen is the first thing the app
  shows.
- *"What happens if this became a real multi-user product tomorrow?"* — The
  single-device encryption and app-lock already built stay exactly as they are; what's
  still missing is everything that requires a server — sync, consent records, audit
  logging, expiring share links (§4).
- *"Why is sexual-health data a separate concern here?"* — because it's already
  structurally separated in the code (`sensitive: true`, opt-in only, never
  auto-suggested) — a technical control, not just a policy statement.
- *"How would you actually get consent from someone in this much pain to track
  this much detail?"* — open question, correctly flagged as future work; the
  adaptive planner's whole design (≤8 fields/day, §PRD 8) exists partly *because*
  burden and consent-to-continue are linked — a tool nobody keeps using has
  effectively revoked consent through disuse.
- *"What if someone forgets their passcode?"* — Their local data is genuinely gone.
  Stated on the lock screen itself before they set one, not discovered after the
  fact — the same property that makes a stolen device useless to an attacker.
