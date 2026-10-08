# SQLite database design — schema v3

The local application uses `backend/data/medtrace.sqlite3`. Migrations and repository
operations are defined in `backend/medtrace_db/database.py`; encryption envelopes
are implemented in `crypto.py`. See [architecture](ARCHITECTURE.md) for HTTP/auth.

## Tables

| Migration | Table | Purpose and ownership |
|---|---|---|
| 1 | `patients` | Unique clinical patient ID mapped to a unique authenticated subject |
| 1 | `consent_events` | Append-only purpose, policy version, grant decision, timestamp |
| 1 | `profiles` | Encrypted standalone profile; retained repository interface |
| 1 | `day_revisions` | Encrypted per-day revisions; retained repository interface |
| 2 | `record_revisions` | Current app's encrypted whole-record snapshots and write request UUIDs |
| 2 | `report_snapshots` | Encrypted approved reports with source revision and timestamp |
| 3 | `accounts` | Unique local username, credential/recovery hashes, local/trial kind |
| 3 | `sessions` | Hashed tokens, account subject, absolute expiry, last activity |
| 3 | `audit_events` | Account action names and timestamps |
| 3 | `report_drafts` | Encrypted previews, owning patient, revision, one-hour expiry |
| 3 | `attachments` | Encrypted event documents, owning patient/event ID, timestamp |
| 3 | `share_grants` | Hashed approved-report access tokens, expiry, revocation, timestamp |

The active HTTP app stores profiles, observations, custom symptoms, medications,
treatments, and events together in `record_revisions`. It does not use the original
standalone `profiles` and `day_revisions` interfaces for new patient writes.

## Ownership and transactions

Foreign keys are enabled, with cascading account/patient deletion. A repository
operation receives a server-authenticated subject and resolves the patient mapping;
HTTP clients cannot supply a substitute ownership subject. Records enforce that
the profile patient ID cannot change.

Writes use `BEGIN IMMEDIATE`. An expected revision prevents stale edits; successful
writes append a revision. `(patient_id, request_id)` is unique and allows identical
write retries while rejecting reuse for different content. Report approval uses
an owned draft and verifies that its source revision still matches the current
record. Reviewed snapshots retain their original scoped source evidence.

Migrations advance `PRAGMA user_version` transactionally. A database newer than the
application's migration list is rejected. Connections enable foreign keys,
`busy_timeout=5000`, and `secure_delete=ON`.

## Payload model and validation

A record contains profile context, explicitly logged daily entries, treatment
history, clinical events, tracked identifiers, optional custom symptom definitions,
and medication shortcuts. Built-in IDs come from `shared/symptoms.json`. Custom IDs
are unique `custom_` identifiers and retain patient wording and optional mapping.

Symptoms use present/absent/unknown state. Severity is 1–10 for present observations.
Daily dates are canonical ISO dates and cannot be future dates. Medication relief
is 0–10; duration is 1–1440 minutes. Text, lists, domains, event types, and lengths
are validated before writes. The HTTP request body limit also bounds record size.

Disabled domains cannot collect new non-unknown answers. Archived custom symptoms
cannot collect changed non-unknown answers until restored. Unchanged historical
observations remain accessible. Turning a domain off is not data deletion.

## Consent

Current permission is the latest consent event for a purpose. The app exposes:

| Purpose | Controls |
|---|---|
| `health_storage` | Saving/editing the working health record and documents |
| `health_analysis` | Analysis and fresh report computation/approval |
| `report_export` | Report approval, PDF downloads, and visit links |

Registration grants storage explicitly and records the chosen analysis decision;
report export starts disabled for personal accounts. Trials record their agreed
example-session purposes. The legacy repository also recognizes `external_ai`,
but no external AI processing or app setting is implemented.

Patients can read existing records and report history after withdrawal. Withdrawing
report export blocks existing grant access as well as new PDF downloads. Permission
withdrawal does not erase records automatically.

## Encryption and retained metadata

Clinical record revisions, previews, reports, and uploaded content are encrypted
with AES-256-GCM. Every seal uses a fresh nonce. Associated data binds payloads to
their purpose, owning patient, record identifier, and revision where applicable.
The protected installation key is separate from SQLite and source control.

Usernames, ownership IDs, hashes, consent purposes, revision numbers, event IDs,
and timestamps remain plaintext/indexed metadata. Payload encryption is not full
SQLite-file encryption. Password/session/recovery values are stored as hashes,
not reversible clinical ciphertext.

## Retention, erasure, and exports

Ordinary edits/removals append a new working record revision. Older revisions and
approved snapshots remain until explicit erasure. Removing a clinical event deletes
its associated attachment rows in the record transaction.

Domain erasure scrubs structured observations/definitions from all whole-record
revisions, disables that domain, clears report drafts, and deletes affected snapshots
and grants. It creates a new working revision so stale tabs cannot restore old data.
Free-text mentions and uploaded documents are not inferred or redacted by this action.

Account deletion cascades through the owned local data. Expired sessions/drafts are
cleaned up, and trial accounts without an active session are deleted. Independently
exported files and OS backups are not recalled. `secure_delete` does not establish
physical erasure of all copies on the operating system or storage device.

Personal JSON exports contain current/retained records, decoded document contents,
permission history, and activity; approved reports require export permission.
The export is unencrypted and there is no automatic import/restore route.
