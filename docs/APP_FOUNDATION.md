# Initial app foundation

Database work branch: `sqlite-db`.

This is the implementation plan, not a statement that security controls are already implemented. The current localStorage prototype remains synthetic-data-only.

## Scope

Keep the React/TypeScript interface and deterministic analysis engine. Run the API and SQLite database locally. Supabase authentication and refresh-token handling are owned by the authentication teammate. The database package uses Python's SQLite driver and transactional versioned SQL migrations. Develop locally with synthetic records first. See `backend/README.md` for implemented behavior and remaining security requirements.

No S3 or object storage in the initial version. Defer uploaded investigation documents, images, and PDFs. Clinical events can still have structured dates, reasons, outcomes, and notes. Generate report downloads on demand from an approved database snapshot, without retaining files on the server.

## Security requirements before real patient data

- Verify authentication tokens at the API, including signature, issuer, audience, and expiry. Resolve patient ownership from the authenticated principal, never a client-supplied patient ID.
- Separate authentication identifiers from clinical profiles through a restricted identity mapping. The analysis engine receives a pseudonymous patient ID.
- Bind the local API to loopback and restrict origins. Use HTTPS for Supabase requests and for any later non-local API deployment. SQLite has no network database connection.
- Encrypt persistent database volumes and backups. Implement authenticated application-level encryption for sensitive clinical payloads and free text before writing them to the database. Keep the minimum identifiers and dates required for indexed queries explicit, with their exposure documented.
- Use a maintained cryptographic library, authenticated encryption such as AES-256-GCM, and a unique nonce per encryption operation. Store ciphertext, nonce, key version, and schema version. Bind ciphertext to its patient, record ID, and field using associated data to prevent substitution.
- Keep encryption keys out of source control, the database, logs, and frontend bundles. Inject a local development key through an ignored environment file; use a separate managed secret or key service for deployments. Key rotation must retain access to older key versions until data is re-encrypted. Losing all applicable keys makes the data unrecoverable.
- Do not persist real clinical data in the existing localStorage store. The first web version has no persistent offline health cache. Keep session credentials out of localStorage; design secure HTTP-only session cookies, CSRF protection, and restricted CORS together if using cookie sessions.
- Limit browser caching of health responses and report downloads with `Cache-Control: no-store`. Exclude health contents and tokens from logs, analytics, traces, URLs, and error reports.
- Check patient ownership on every read and mutation, including evidence, reports, and bulk operations. SQLite has no PostgreSQL-style row-level policies; repository authorization and OS protection of the local file are required. Direct database access is privileged.
- Add request size limits, rate limits for authentication and share access, and validation of all incoming records. Production configuration must fail closed if authentication or encryption configuration is missing.

## Consent and sharing

Store append-only consent events with patient ID, purpose, policy version, decision, effective timestamp, and originating actor. Determine current consent from those events. Require the applicable authorization before health-record collection or processing; avoid bundling optional purposes into onboarding.

Optional sensitive modules begin disabled. Enabling a module and agreeing to a processing purpose are distinct records. Disabling a module stops future prompts and collection; explicitly offer deletion of existing module data rather than silently treating disabling as deletion.

Do not send health records to an external AI provider in the initial version. Deterministic reports already exist. Any later external AI feature requires a separate disclosed opt-in, provider configuration review, minimum necessary data transfer, and withdrawal behavior.

Every shared report is an immutable, patient-reviewed snapshot. Filter selected domains before computing report claims so an excluded domain cannot leak through a combined finding or evidence link. Private notes are excluded by default. Persist the exact scope and approved snapshot revision.

Initial sharing is patient-approved report export. Hosted share links are deferred because a local-only service cannot provide remotely reachable reports. If hosted sharing is introduced, grants must reference only the approved snapshot, store random access tokens as hashes, expire, support revocation, and be checked on every access. Revocation cannot retrieve a report already downloaded by a recipient.

Provide export and account/data deletion workflows before real-data onboarding. Document the handling of revisions, derived evidence, report copies, revoked grants, and backups; audit history is not an excuse to retain clinical content indefinitely. Consent withdrawal stops affected future processing and sharing, with retention/deletion behavior disclosed rather than implicitly promised.

## Data model decisions

Separate profile/preferences, symptom vocabulary, daily observations, detailed episodes, medication events, treatments, clinical events, consent, analysis runs, report claims/evidence, share grants, and audits.

Use UUIDs and local calendar dates for symptom days; recording times are UTC timestamps. Preserve present/absent/unknown semantics: unanswered or unasked questions remain unknown. Enforce valid severity and date ranges. Maintain observation revisions for corrections, and bind immutable reports to the exact input revisions used. Support idempotent writes and optimistic concurrency so retries or stale edits do not duplicate or silently overwrite observations.

## Delivery order

1. Schema and migration foundation; API configuration; synthetic seed fixtures; encryption utility and consent event model.
2. Authentication and ownership; consent-gated onboarding; patient preferences and symptom vocabulary.
3. Daily entry endpoints and frontend integration, with revisions, validation, and idempotency.
4. Medication, treatment, and clinical-event timeline.
5. Persisted-record adapter for the existing TypeScript engine; trusted server-side report generation, fidelity verification, and immutable evidence snapshots. Avoid a premature Python engine rewrite.
6. Patient report approval, scoped report export, and deletion; hosted sharing deferred.
7. Mobile encrypted SQLite and an explicit offline synchronization/conflict design in a later milestone.

First milestone: an authenticated synthetic patient consents, saves a check-in, reloads it, and sees analysis based on the saved record.

## Required verification

Verify encryption round trips, tampering and substitution rejection, nonce uniqueness behavior, key-version handling, and missing-key failures. Verify cross-patient access denial, invalid/expired tokens, consent gating and withdrawal, optional-module collection rules, duplicate retries, stale revisions, missing-data semantics, and expiry/revocation of scoped shares. Verify that shared claim evidence cannot expose excluded domains and that logs contain no clinical payloads or credentials.

Run existing engine checks when integrating persisted records. Before real-data use, exercise export/deletion and backup restoration, review deployment encryption and key recovery, and obtain a context-specific privacy/security review. This plan does not itself establish legal compliance.
