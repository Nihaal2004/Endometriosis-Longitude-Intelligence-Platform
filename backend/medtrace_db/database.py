"""SQLite repository with transactional migrations and encrypted clinical payloads."""
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
import sqlite3
from uuid import UUID, uuid4

from .crypto import Vault


class ConsentRequired(PermissionError):
    pass


class Conflict(ValueError):
    pass


MIGRATIONS = [
    [
        'CREATE TABLE patients (id TEXT PRIMARY KEY, auth_subject TEXT NOT NULL UNIQUE)',
        '''CREATE TABLE consent_events (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
            purpose TEXT NOT NULL, policy_version TEXT NOT NULL,
            granted INTEGER NOT NULL CHECK(granted IN (0,1)), recorded_at TEXT NOT NULL)''',
        'CREATE INDEX consent_lookup ON consent_events(patient_id, purpose, sequence)',
        '''CREATE TABLE profiles (
            patient_id TEXT PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
            payload BLOB NOT NULL)''',
        '''CREATE TABLE day_revisions (
            patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
            day TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
            request_id TEXT NOT NULL, payload BLOB NOT NULL, recorded_at TEXT NOT NULL,
            PRIMARY KEY(patient_id, day, revision), UNIQUE(patient_id, request_id))''',
    ],
]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_day(day: dict) -> None:
    if date.fromisoformat(day['date']).isoformat() != day['date']:
        raise ValueError('Use yyyy-mm-dd dates')
    if day.get('logged') is not True:
        raise ValueError('Only explicitly logged entries may be saved')
    if day.get('bleeding') not in (None, 'none', 'spotting', 'light', 'moderate', 'heavy', 'very_heavy'):
        raise ValueError('Invalid bleeding level')
    impact = day.get('impact')
    if impact is not None and (type(impact) is not int or impact not in range(4)):
        raise ValueError('Invalid impact level')
    if day.get('depth') not in (None, 'quick', 'standard', 'detailed'):
        raise ValueError('Invalid check-in depth')
    if not isinstance(day.get('symptoms'), dict):
        raise ValueError('Symptoms must be an observation mapping')
    for symptom, observation in day['symptoms'].items():
        if not isinstance(symptom, str) or not symptom or not isinstance(observation, dict):
            raise ValueError('Invalid symptom observation')
        state = observation.get('state')
        if state not in ('present', 'absent', 'unknown'):
            raise ValueError('Explicit observation state required')
        severity = observation.get('severity')
        if severity is not None and (
            state != 'present' or type(severity) is not int or not 1 <= severity <= 10
        ):
            raise ValueError('Severity must be 1–10 on a present symptom; zero means absent')


class Database:
    """Pass ONLY a verified Supabase JWT subject from the authentication layer.

    This repository does not authenticate callers. It scopes every operation by
    subject; it never accepts a client-selected patient UUID for health operations.
    """
    def __init__(self, path: str | Path, vault: Vault):
        self.vault = vault
        self.connection = sqlite3.connect(str(path), isolation_level=None)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute('PRAGMA foreign_keys=ON')
        self.connection.execute('PRAGMA busy_timeout=5000')
        try:
            with self.transaction():
                version = self.connection.execute('PRAGMA user_version').fetchone()[0]
                if version > len(MIGRATIONS):
                    raise RuntimeError('Database schema is newer than this application')
                for index in range(version, len(MIGRATIONS)):
                    for statement in MIGRATIONS[index]:
                        self.connection.execute(statement)
                    self.connection.execute(f'PRAGMA user_version={index + 1}')
        except Exception:
            self.close()
            raise

    @contextmanager
    def transaction(self):
        self.connection.execute('BEGIN IMMEDIATE')
        try:
            yield
            self.connection.execute('COMMIT')
        except BaseException:
            self.connection.execute('ROLLBACK')
            raise

    def close(self):
        self.connection.close()

    def create_patient(self, verified_subject: str) -> str:
        subject = str(UUID(verified_subject))
        with self.transaction():
            self.connection.execute('INSERT OR IGNORE INTO patients VALUES (?, ?)',
                                    (str(uuid4()), subject))
            return self._patient(subject)

    def _patient(self, subject: str) -> str:
        subject = str(UUID(subject))
        row = self.connection.execute('SELECT id FROM patients WHERE auth_subject=?', (subject,)).fetchone()
        if row is None:
            raise PermissionError('Patient is not provisioned')
        return row['id']

    def record_consent(self, subject: str, purpose: str, policy_version: str, granted: bool):
        if purpose not in ('health_storage', 'health_analysis', 'external_ai', 'report_export'):
            raise ValueError('Unknown consent purpose')
        if not policy_version.strip() or type(granted) is not bool:
            raise ValueError('Policy version and explicit decision required')
        with self.transaction():
            patient = self._patient(subject)
            self.connection.execute('''INSERT INTO consent_events
                (patient_id,purpose,policy_version,granted,recorded_at) VALUES (?,?,?,?,?)''',
                (patient, purpose, policy_version, int(granted), now()))

    def _require_consent(self, patient: str, purpose: str):
        row = self.connection.execute('''SELECT granted FROM consent_events
            WHERE patient_id=? AND purpose=? ORDER BY sequence DESC LIMIT 1''', (patient, purpose)).fetchone()
        if row is None or not row['granted']:
            raise ConsentRequired(f'Consent required: {purpose}')

    def save_profile(self, subject: str, profile: dict):
        if not isinstance(profile, dict) or 'id' in profile or 'auth_subject' in profile:
            raise ValueError('Profile must not override identity')
        with self.transaction():
            patient = self._patient(subject)
            self._require_consent(patient, 'health_storage')
            payload = self.vault.seal(profile, f'profile:{patient}')
            self.connection.execute('''INSERT INTO profiles VALUES (?,?)
                ON CONFLICT(patient_id) DO UPDATE SET payload=excluded.payload''', (patient, payload))

    def read_profile(self, subject: str) -> dict | None:
        patient = self._patient(subject)
        row = self.connection.execute('SELECT payload FROM profiles WHERE patient_id=?', (patient,)).fetchone()
        return None if row is None else self.vault.open(row['payload'], f'profile:{patient}')

    def save_day(self, subject: str, day: dict, *, expected_revision: int, request_id: str) -> int:
        validate_day(day)
        if type(expected_revision) is not int or expected_revision < 0:
            raise ValueError('A nonnegative expected revision is required')
        request_id = str(UUID(request_id))
        with self.transaction():
            patient = self._patient(subject)
            self._require_consent(patient, 'health_storage')
            previous = self.connection.execute('''SELECT * FROM day_revisions
                WHERE patient_id=? AND request_id=?''', (patient, request_id)).fetchone()
            if previous:
                context = f'day:{patient}:{previous["day"]}:{previous["revision"]}'
                if self.vault.open(previous['payload'], context) != day:
                    raise Conflict('Request ID was used for a different entry')
                return previous['revision']
            row = self.connection.execute('''SELECT MAX(revision) FROM day_revisions
                WHERE patient_id=? AND day=?''', (patient, day['date'])).fetchone()
            current = row[0] or 0
            if current != expected_revision:
                raise Conflict('Entry changed; reload before editing')
            revision = current + 1
            payload = self.vault.seal(day, f'day:{patient}:{day["date"]}:{revision}')
            self.connection.execute('INSERT INTO day_revisions VALUES (?,?,?,?,?,?)',
                (patient, day['date'], revision, request_id, payload, now()))
            return revision

    def read_days(self, subject: str, start: str, end: str) -> list[dict]:
        if date.fromisoformat(start) > date.fromisoformat(end):
            raise ValueError('Invalid date range')
        patient = self._patient(subject)
        rows = self.connection.execute('''SELECT d.* FROM day_revisions d
            WHERE d.patient_id=? AND d.day BETWEEN ? AND ?
            AND d.revision=(SELECT MAX(r.revision) FROM day_revisions r
                WHERE r.patient_id=d.patient_id AND r.day=d.day) ORDER BY d.day''',
            (patient, start, end)).fetchall()
        return [{'revision': r['revision'], 'entry': self.vault.open(
            r['payload'], f'day:{patient}:{r["day"]}:{r["revision"]}')} for r in rows]

    def analysis_days(self, subject: str, start: str, end: str) -> list[dict]:
        with self.transaction():
            self._require_consent(self._patient(subject), 'health_analysis')
            return [row['entry'] for row in self.read_days(subject, start, end)]
