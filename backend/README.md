# Local SQLite foundation

See [SQLite database design](../docs/SQLITE_DESIGN.md) for the schema diagram,
column definitions, encryption format, consent rules, and integration contracts.

This package implements patient identity mapping, encrypted profiles and day records,
versioned consent events, transactional schema migrations, idempotent writes, and
optimistic concurrency. It uses Python's SQLite driver; no database server is required.

From the repository root in PowerShell:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
Push-Location backend
.venv/Scripts/python.exe -m pytest -q
Pop-Location
```

## Authentication integration

Your teammate's backend must verify Supabase JWTs before calling this repository.
Pass the verified JWT `sub` (a UUID) to repository methods. Never accept a subject
or local patient ID from an untrusted request body. No JWT verification, session
handling, or refresh-token persistence is implemented here.

```python
from pathlib import Path
from medtrace_db import Database, Vault, load_os_key

# Use a stable installation-specific name. Create only during explicit first setup.
# On later opens use create=False so a missing key fails instead of replacing it.
key = load_os_key('installation-uuid:key-v1', create=False)
db = Database(Path('health.sqlite3'), Vault({1: key}, active_version=1))
patient_id = db.create_patient(verified_supabase_subject)
db.record_consent(verified_supabase_subject, 'health_storage', 'privacy-v1', True)
# Also obtain separate health_analysis consent before analysis_days().
```

Windows Credential Manager holds the installation key under the current OS user.
There is no plaintext key fallback. Tests use ephemeral in-memory keys and synthetic
records, and do not write credentials to the OS. OS credential storage does not
protect against malware or another process already running as the same user.

## Storage contract

`save_day(subject, entry, expected_revision=0, request_id=uuid)` creates an entry.
Subsequent edits require the last returned revision and a fresh request UUID.
Retries of the same UUID and payload return the original revision; conflicting
payloads and stale revisions fail. Each saved day is a complete replacement of the
current day, not a partial patch; the old revision remains encrypted in history.

Entries use the existing TypeScript `DayRecord` shape. A zero symptom answer must
be converted to `{state: 'absent'}` without severity. Missing observations remain
missing/unknown; missing calendar days are not materialized as symptom-free days.
`read_days()` returns current entries with revisions. `analysis_days()` returns
engine-shaped entries only after checking health-analysis consent.

Consent events are appended and ordered by database sequence. Withdrawing storage
consent blocks future writes; withdrawing analysis consent blocks analysis access.
Reading one's existing records remains allowed for patient access. Policy migration
and renewed-consent requirements must be added when introducing new purposes or
material policy changes. Direct SQL access is privileged and bypasses repository
consent checks; do not expose the connection through an API.

Use one Database connection per worker/request on its owning thread; do not share
connections between FastAPI threads. Transactions serialize writes and foreign keys
are enabled. Schema migrations use `PRAGMA user_version` and reject newer schemas.

## Encryption boundary and unfinished work

Clinical profile and daily payloads are AES-256-GCM encrypted with fresh random
nonces. Associated data binds each payload to its patient, day, and revision. Key
versions support reading historical keys; re-encryption tooling is not implemented.

**The SQLite file itself is not SQLCipher encrypted.** Patient UUIDs, Supabase subject
mappings, dates, revision counts, and consent metadata are visible. Entire-file
encryption, encrypted backups with recovery keys, and OS file permissions still need
implementation before real patient data. Never use a JWT as an encryption key.

This is an independently testable foundation, not a real-patient-ready application.
Optional-module enforcement and symptom vocabulary validation, full profile/medication
validation, treatment and clinical-event tables, export/deletion, report snapshots,
audit logging, API integration, and frontend replacement of localStorage are pending.
Do not route analysis around `analysis_days()` after consent withdrawal.
