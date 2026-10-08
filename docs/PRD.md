# Product requirements — local application

This version targets a single computer with multiple isolated local patient
accounts. The product organizes patient-reported history and supports preparation
for a clinical visit. It does not diagnose, score disease likelihood, stage disease,
predict cycles, or prescribe treatment.

## Functional scope

| Area | Current requirement |
|---|---|
| Accounts | Registration, login, saved recovery code, password change/reset, session expiry |
| Onboarding | Three-step baseline profile, domains, tracked symptoms, optional reminder |
| Trial | Fictional examples isolated from personal accounts, with session-end cleanup |
| Logging | Quick/standard/detailed entry, tri-state symptoms, severity, bleeding, impact, medications, notes, episodes |
| Personalization | Custom wording/mapping, archive/restore, medication shortcuts |
| History | Editable treatments, healthcare events, and encrypted event attachments |
| Analysis | Descriptive counts, retrospective cycle alignment, supported patterns, verified summary statements |
| Clinical visit | Sharing scope, patient questions, evidence preview, explicit review, immutable approval |
| Reports | Owned history, PDF download/print, expiring/revocable computer-local visit links |
| Privacy | Separate storage/analysis/export decisions, audits, export, domain erasure, account deletion |
| Local operation | One-command build/start, no cloud credentials, encrypted SQLite payloads |

## Data and evidence rules

Missing days and unanswered symptoms are unknown, not absent. Symptom rates use
observed days as denominators. Pattern detection uses named methods and gates on
coverage, observation/cycle/event counts, and multiplicity-adjusted evidence.
Numeric report statements are independently verified from the scoped source data.

Sensitive domains are opt-in for collection. Report defaults exclude sexual health,
fertility, and private notes/episode details. Sharing choices filter data before
report computation. Uploaded documents are never automatically included in reports.
Reports are generated locally and require explicit review before approval/export.

## Workflow review criteria

- A new account can complete setup and log without a cloud account or API key.
- One account cannot read another account's record, document, or report.
- A trial cannot replace a personal account's record.
- Unknown answers remain unknown across saves, analysis, and reports.
- Saving an entry updates the current record; stale revisions are rejected.
- Disabling collection or withdrawing purpose permission has the documented effect.
- Report scope excludes unselected information before analysis, including evidence.
- Approval rejects expired previews and previews from changed record revisions.
- Approved snapshots retain their original evidence during ordinary record edits.
- PDFs include patient-selected history and questions and explain their limitations.
- Visit grants enforce expiry, revocation, ownership, and current export permission.
- Account/domain erasure and exports follow documented retention boundaries.
- The interface works at desktop and mobile widths with keyboard-accessible controls.

These are review criteria, not a claim that all integration scenarios have passed
an automated suite. See [development](DEVELOPMENT.md) for available verification.

## Outside this release

Supabase authentication, hosted storage/sharing, device synchronization, generative
AI, native background notifications, automated backup import, and clinical validation
are deferred. Browser reminders require the app to be open. Synthetic engine results
do not establish clinical utility or reduced diagnostic delay.
