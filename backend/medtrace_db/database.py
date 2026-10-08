"""SQLite repository with transactional migrations and encrypted clinical payloads."""
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
import sqlite3
from uuid import UUID, uuid4
import math
import json
import time

from .crypto import Vault
VOCABULARY = {s['id']: s for s in json.loads((Path(__file__).resolve().parents[2] / 'shared' / 'symptoms.json').read_text(encoding='utf-8'))}


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
    [
        '''CREATE TABLE record_revisions (
            patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
            revision INTEGER NOT NULL, request_id TEXT NOT NULL, payload BLOB NOT NULL,
            recorded_at TEXT NOT NULL, PRIMARY KEY(patient_id,revision),
            UNIQUE(patient_id,request_id))''',
        '''CREATE TABLE report_snapshots (
            id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
            record_revision INTEGER NOT NULL, payload BLOB NOT NULL, recorded_at TEXT NOT NULL)''',
    ],
    [
        '''CREATE TABLE accounts (
            subject TEXT PRIMARY KEY REFERENCES patients(auth_subject) ON DELETE CASCADE,
            username TEXT UNIQUE, password_hash TEXT, recovery_hash TEXT,
            kind TEXT NOT NULL CHECK(kind IN ('local','trial')), created_at TEXT NOT NULL)''',
        '''CREATE TABLE sessions (
            token_hash TEXT PRIMARY KEY, subject TEXT NOT NULL REFERENCES accounts(subject) ON DELETE CASCADE,
            expires_at REAL NOT NULL, last_seen REAL NOT NULL)''',
        '''CREATE TABLE audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL REFERENCES accounts(subject) ON DELETE CASCADE,
            action TEXT NOT NULL, recorded_at TEXT NOT NULL)''',
        '''CREATE TABLE report_drafts (
            id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
            revision INTEGER NOT NULL, payload BLOB NOT NULL, expires_at REAL NOT NULL)''',
        '''CREATE TABLE attachments (
            id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
            event_id TEXT NOT NULL, payload BLOB NOT NULL, recorded_at TEXT NOT NULL)''',
        '''CREATE TABLE share_grants (
            token_hash TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
            report_id TEXT NOT NULL REFERENCES report_snapshots(id) ON DELETE CASCADE,
            expires_at REAL NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)''',
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
    """Identity-agnostic repository scoped by a server-authenticated subject.

    The local auth adapter resolves the subject from an opaque session cookie.
    A future Supabase adapter can provide the same ownership boundary.
    """
    def __init__(self, path: str | Path, vault: Vault):
        self.vault = vault
        self.connection = sqlite3.connect(str(path), isolation_level=None)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute('PRAGMA foreign_keys=ON')
        self.connection.execute('PRAGMA busy_timeout=5000')
        self.connection.execute('PRAGMA secure_delete=ON')
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

    def read_record(self, subject: str, *, analysis: bool = False):
        patient = self._patient(subject)
        if analysis:
            with self.transaction():
                self._require_consent(patient, 'health_analysis')
                return self._read_record(patient)
        return self._read_record(patient)

    def _read_record(self, patient: str):
        row = self.connection.execute('SELECT * FROM record_revisions WHERE patient_id=? ORDER BY revision DESC LIMIT 1', (patient,)).fetchone()
        if row is None:
            return None
        return {'revision': row['revision'], 'record': self.vault.open(row['payload'], f'record:{patient}:{row["revision"]}')}

    def provision_demo(self, subject: str, record: dict, request_id: str):
        """Atomically provision synthetic records and their demo-purpose grants."""
        subject = str(UUID(subject))
        request_id = str(UUID(request_id))
        validate_record(record)
        with self.transaction():
            self.connection.execute('INSERT OR IGNORE INTO patients VALUES (?,?)', (str(uuid4()), subject))
            patient = self._patient(subject)
            current = self._read_record(patient)
            if current is None:
                for purpose in ('health_storage', 'health_analysis', 'report_export'):
                    self.connection.execute('''INSERT INTO consent_events
                        (patient_id,purpose,policy_version,granted,recorded_at) VALUES (?,?,?,?,?)''',
                        (patient, purpose, 'synthetic-demo-v1', 1, now()))
                record = {**record, 'profile': {**record['profile'], 'id': patient}}
                validate_module_changes(record, None)
                self.connection.execute('INSERT INTO record_revisions VALUES (?,?,?,?,?)',
                    (patient, 1, request_id, self.vault.seal(record, f'record:{patient}:1'), now()))
            self._require_consent(patient, 'health_analysis')
            return self._read_record(patient)

    def save_record(self, subject: str, record: dict, *, expected_revision: int, request_id: str):
        validate_record(record)
        request_id = str(UUID(request_id))
        if type(expected_revision) is not int or expected_revision < 0:
            raise ValueError('Invalid expected revision')
        with self.transaction():
            patient = self._patient(subject)
            self._require_consent(patient, 'health_storage')
            if record['profile'].get('id') != patient:
                raise ValueError('Patient identity cannot be changed')
            previous = self.connection.execute('SELECT * FROM record_revisions WHERE patient_id=? AND request_id=?', (patient, request_id)).fetchone()
            if previous:
                if self.vault.open(previous['payload'], f'record:{patient}:{previous["revision"]}') != record:
                    raise Conflict('Request ID already used')
                return previous['revision']
            current = self.read_record(subject)
            validate_module_changes(record, current['record'] if current else None)
            revision = current['revision'] if current else 0
            if revision != expected_revision:
                raise Conflict('Record changed; reload before editing')
            revision += 1
            payload = self.vault.seal(record, f'record:{patient}:{revision}')
            self.connection.execute('INSERT INTO record_revisions VALUES (?,?,?,?,?)', (patient, revision, request_id, payload, now()))
            kept_events = {e['id'] for e in record['clinicalEvents']}
            for attachment in self.connection.execute('SELECT id,event_id FROM attachments WHERE patient_id=?', (patient,)).fetchall():
                if attachment['event_id'] not in kept_events:
                    self.connection.execute('DELETE FROM attachments WHERE id=?', (attachment['id'],))
            return revision

    def erase_domain(self, subject, domain, expected_revision):
        """Erase structured observations from every retained revision and affected reports."""
        if domain not in ('pain', 'bowel', 'urinary', 'systemic', 'sexual', 'extrapelvic'):
            raise ValueError('Invalid symptom domain')
        if type(expected_revision) is not int or expected_revision < 1:
            raise ValueError('Invalid record revision')
        with self.transaction():
            patient = self._patient(subject)
            current = self._read_record(patient)
            if current['revision'] != expected_revision:
                raise Conflict('Record changed. Reload before deleting domain data.')
            rows = self.connection.execute('SELECT * FROM record_revisions WHERE patient_id=?', (patient,)).fetchall()
            all_ids = set()
            records = []
            for row in rows:
                record = self.vault.open(row['payload'], f'record:{patient}:{row["revision"]}')
                ids = {sid for sid, definition in record_vocabulary(record).items() if definition['domain'] == domain}
                all_ids.update(ids)
                record['days'] = [{**day, 'symptoms': {sid: observation for sid, observation in day['symptoms'].items() if sid not in ids}} for day in record['days']]
                record['trackedSymptomIds'] = [sid for sid in record['trackedSymptomIds'] if sid not in ids]
                record['customSymptoms'] = [definition for definition in record.get('customSymptoms', []) if definition['domain'] != domain]
                record['profile']['enabledDomains'] = [value for value in record['profile']['enabledDomains'] if value != domain]
                for treatment in record['treatments']:
                    if treatment.get('indicationSymptomId') in ids:
                        treatment.pop('indicationSymptomId', None)
                records.append((row['revision'], record))
            for revision, record in records:
                self.connection.execute('UPDATE record_revisions SET payload=? WHERE patient_id=? AND revision=?', (self.vault.seal(record, f'record:{patient}:{revision}'), patient, revision))
            for row in self.connection.execute('SELECT * FROM report_snapshots WHERE patient_id=?', (patient,)).fetchall():
                report = self.vault.open(row['payload'], f'report:{patient}:{row["id"]}')
                source = report.get('sourceRecord', {})
                affected = domain in report.get('scope', {}).get('domains', []) or any(set(day.get('symptoms', {})) & all_ids for day in source.get('days', []))
                if affected:
                    self.connection.execute('DELETE FROM report_snapshots WHERE id=?', (row['id'],))
            self.connection.execute('DELETE FROM report_drafts WHERE patient_id=?', (patient,))
            latest = next(record for revision, record in records if revision == current['revision'])
            revision = current['revision'] + 1
            self.connection.execute('INSERT INTO record_revisions VALUES (?,?,?,?,?)', (patient, revision, str(uuid4()), self.vault.seal(latest, f'record:{patient}:{revision}'), now()))

    def save_report(self, subject: str, report: dict, revision: int, *, request_id: str):
        report_id = str(UUID(request_id))
        if type(revision) is not int or revision < 1:
            raise ValueError('Invalid report revision')
        validate_report(report)
        with self.transaction():
            patient = self._patient(subject)
            self._require_consent(patient, 'report_export')
            self._require_consent(patient, 'health_analysis')
            existing = self.connection.execute('SELECT * FROM report_snapshots WHERE id=?', (report_id,)).fetchone()
            if existing:
                if existing['patient_id'] != patient:
                    raise Conflict('Report request ID already used')
                saved = self.vault.open(existing['payload'], f'report:{patient}:{report_id}')
                ignored = {'sourceRecord', 'profile', 'recordRevision', 'clinicalEvents', 'treatments', 'savedAt'}
                if existing['record_revision'] != revision or {k: v for k, v in saved.items() if k not in ignored} != {k: v for k, v in report.items() if k not in ignored}:
                    raise Conflict('Report request ID already used for different content')
                return report_id
            current = self.read_record(subject)
            if current is None or current['revision'] != revision:
                raise Conflict('Record changed; regenerate and review the report')
            # Source data and clinical identity come from the committed revision,
            # never from client-supplied copies. Claims are browser-engine output.
            report = {**report, 'sourceRecord': current['record'],
                'profile': current['record']['profile'], 'recordRevision': revision,
                'clinicalEvents': current['record']['clinicalEvents'],
                'treatments': current['record']['treatments'], 'savedAt': now()}
            self.connection.execute('INSERT INTO report_snapshots VALUES (?,?,?,?,?)', (report_id, patient, revision, self.vault.seal(report, f'report:{patient}:{report_id}'), now()))
            return report_id

    def list_reports(self, subject: str):
        patient = self._patient(subject)
        return [dict(row) for row in self.connection.execute('''SELECT id,record_revision,recorded_at
            FROM report_snapshots WHERE patient_id=? ORDER BY recorded_at DESC,id DESC''', (patient,))]

    def read_report(self, subject: str, report_id: str):
        patient = self._patient(subject)
        row = self.connection.execute('SELECT * FROM report_snapshots WHERE patient_id=? AND id=?',
            (patient, str(UUID(report_id)))).fetchone()
        if row is None:
            return None
        return self.vault.open(row['payload'], f'report:{patient}:{row["id"]}')

    def approve_draft(self, subject, draft_id, request_id):
        identifier = str(UUID(request_id))
        with self.transaction():
            patient = self._patient(subject)
            self._require_consent(patient, 'health_analysis')
            self._require_consent(patient, 'report_export')
            existing = self.connection.execute('SELECT * FROM report_snapshots WHERE id=?', (identifier,)).fetchone()
            if existing:
                if existing['patient_id'] != patient:
                    raise Conflict('Report request ID already used')
                saved = self.vault.open(existing['payload'], f'report:{patient}:{identifier}')
                if saved.get('draftId') != draft_id:
                    raise Conflict('Report request ID already used')
                return identifier, saved
            draft = self.connection.execute('SELECT * FROM report_drafts WHERE id=? AND patient_id=? AND expires_at>?', (str(UUID(draft_id)), patient, time.time())).fetchone()
            if draft is None:
                raise ValueError('Report preview expired. Generate a new preview.')
            current = self._read_record(patient)
            if current['revision'] != draft['revision']:
                raise Conflict('Your record changed. Preview and review a new report.')
            report = self.vault.open(draft['payload'], f'draft:{patient}:{draft["id"]}')
            report.update({'reviewed': True, 'draftId': draft_id, 'savedAt': now()})
            validate_report(report)
            self.connection.execute('INSERT INTO report_snapshots VALUES (?,?,?,?,?)', (identifier, patient, draft['revision'], self.vault.seal(report, f'report:{patient}:{identifier}'), now()))
            return identifier, report


def validate_record(record):
    if not isinstance(record, dict):
        raise ValueError('Record required')
    profile = record.get('profile', {})
    vocabulary = record_vocabulary(record)
    if not isinstance(profile, dict) or not isinstance(profile.get('displayName'), str) or not profile['displayName'].strip():
        raise ValueError('Patient name required')
    check_text(profile['displayName'], 'Patient name', 80)
    for field in ('ageRange',):
        if profile.get(field) is not None:
            check_text(profile[field], field, 80)
    reminder = profile.get('reminderTime', '')
    if not isinstance(reminder, str) or (reminder and (len(reminder) != 5 or reminder[2] != ':' or not reminder[:2].isdigit() or not reminder[3:].isdigit() or int(reminder[:2]) > 23 or int(reminder[3:]) > 59)):
        raise ValueError('Invalid reminder time')
    for field in ('familyHistory', 'previousPelvicSurgery', 'onboarded'):
        if profile.get(field) is not None and type(profile[field]) is not bool:
            raise ValueError(f'Invalid {field}')
    for field, lower, upper in (('symptomOnsetYear', 1900, date.today().year), ('ageAtMenarche', 5, 30)):
        value = profile.get(field)
        if value is not None and (type(value) is not int or not lower <= value <= upper):
            raise ValueError(f'Invalid {field}')
    if profile.get('cycleRegularity') not in (None, 'regular', 'variable', 'highly_irregular'):
        raise ValueError('Invalid cycle regularity')
    cycle = profile.get('usualCycleLength')
    if cycle is not None and (not isinstance(cycle, list) or len(cycle) != 2 or
        any(type(n) is not int or not 10 <= n <= 180 for n in cycle) or cycle[0] > cycle[1]):
        raise ValueError('Invalid usual cycle length range')
    check_string_list([] if profile.get('priorLabels') is None else profile['priorLabels'], 'Previous labels')
    if profile.get('diagnosisStatus') not in ('suspected', 'confirmed', 'undiagnosed'):
        raise ValueError('Invalid diagnosis status')
    domains = profile.get('enabledDomains')
    if not isinstance(domains, list) or any(d not in ('pain', 'bowel', 'urinary', 'systemic', 'sexual', 'extrapelvic') for d in domains):
        raise ValueError('Invalid symptom domains')
    if not isinstance(record.get('trackedSymptomIds'), list) or len(record['trackedSymptomIds']) > len(vocabulary) or any(not isinstance(s, str) or s not in vocabulary for s in record['trackedSymptomIds']):
        raise ValueError('Invalid symptom list')
    shortcuts = record.get('medicationList', [])
    if not isinstance(shortcuts, list) or len(shortcuts) > 100:
        raise ValueError('Invalid medication shortcuts')
    med_ids = set()
    for medication in shortcuts:
        if not isinstance(medication, dict):
            raise ValueError('Invalid medication shortcut')
        check_text(medication.get('medicationId'), 'Medication identifier', 100)
        check_text(medication.get('label'), 'Medication name', 200)
        if not medication['label'].strip() or medication['medicationId'] in med_ids:
            raise ValueError('Medication shortcut requires a unique identifier and name')
        med_ids.add(medication['medicationId'])
        if medication.get('dose') is not None:
            check_text(medication['dose'], 'Medication dose', 200)
    days = record.get('days')
    if not isinstance(days, list) or len(days) > 10000:
        raise ValueError('Invalid daily records')
    dates = set()
    for day in days:
        if not isinstance(day, dict):
            raise ValueError('Invalid day')
        validate_day(day)
        if any(symptom not in vocabulary for symptom in day['symptoms']):
            raise ValueError('Unknown symptom identifier')
        if date.fromisoformat(day['date']) > date.today():
            raise ValueError('Daily entries cannot be in the future')
        if day.get('note') is not None:
            check_text(day['note'], 'Daily note', 3000)
        check_string_list([] if day.get('impactDomains') is None else day['impactDomains'], 'Impact domains')
        episode = day.get('episode')
        if episode is not None:
            if not isinstance(episode, dict):
                raise ValueError('Invalid episode')
            for field in ('location', 'character', 'timing', 'trigger', 'response'):
                if episode.get(field) is not None:
                    check_text(episode[field], field, 1000)
            duration = episode.get('durationMinutes')
            if duration is not None and (type(duration) is not int or not 1 <= duration <= 1440):
                raise ValueError('Invalid episode duration')
        medications = [] if day.get('medications') is None else day['medications']
        if not isinstance(medications, list) or len(medications) > 100:
            raise ValueError('Invalid medications')
        for medication in medications:
            if not isinstance(medication, dict) or not medication.get('medicationId'):
                raise ValueError('Medication identifier required')
            check_text(medication.get('label'), 'Medication name', 200)
            if not medication['label'].strip():
                raise ValueError('Medication name required')
            if medication.get('dose') is not None:
                check_text(medication['dose'], 'Medication dose', 200)
            relief = medication.get('perceivedRelief')
            if relief is not None and (type(relief) is not int or not 0 <= relief <= 10):
                raise ValueError('Invalid perceived relief')
        if day['date'] in dates:
            raise ValueError('Duplicate daily entry')
        dates.add(day['date'])
    for field in ('treatments', 'clinicalEvents'):
        events = record.get(field)
        if not isinstance(events, list):
            raise ValueError('Invalid event list')
        ids = set()
        for event in events:
            if not isinstance(event, dict) or not isinstance(event.get('label'), str) or not event['label'].strip() or not event.get('id') or event['id'] in ids:
                raise ValueError('Event requires unique ID and label')
            ids.add(event['id'])
            check_text(event['id'], 'Event identifier', 100)
            check_text(event['label'], 'Event name', 200)
            kinds = ('combined_oral_contraceptive', 'progestin', 'gnrh', 'iud', 'physiotherapy', 'pain_management', 'surgery', 'fertility', 'other') if field == 'treatments' else ('gp', 'gynaecology', 'emergency', 'referral', 'ultrasound', 'mri', 'ct', 'laparoscopy', 'surgery', 'diagnosis', 'fertility', 'admission')
            if event.get('kind') not in kinds:
                raise ValueError('Invalid event type')
            for text_field in ('dose', 'reason', 'outcome', 'note', 'indicationSymptomId'):
                if event.get(text_field) is not None:
                    check_text(event[text_field], text_field, 3000)
            check_string_list(event.get('sideEffects', []), 'Side effects')
            if event.get('patientPerceivedChange') not in (None, 'better', 'unchanged', 'worse', 'unsure'):
                raise ValueError('Invalid perceived change')
            start = event.get('startDate') if field == 'treatments' else event.get('date')
            if date.fromisoformat(start).isoformat() != start:
                raise ValueError('Invalid event date')
            if event.get('endDate'):
                end = date.fromisoformat(event['endDate'])
                if end.isoformat() != event['endDate']:
                    raise ValueError('Invalid treatment end date')
                if end < date.fromisoformat(start):
                    raise ValueError('Treatment ends before it starts')


def validate_module_changes(record, previous):
    vocabulary = record_vocabulary(record)
    old_days = {d['date']: d for d in previous['days']} if previous else {}
    enabled = record['profile']['enabledDomains']
    for day in record['days']:
        old = old_days.get(day['date'], {}).get('symptoms', {})
        for symptom, observation in day['symptoms'].items():
            if vocabulary[symptom].get('archived') and observation['state'] != 'unknown' and old.get(symptom) != observation:
                raise ValueError('Restore an archived symptom before adding observations')
            if vocabulary[symptom]['domain'] not in enabled and observation['state'] != 'unknown' and old.get(symptom) != observation:
                raise ValueError('Enable the symptom domain before collecting new observations')


def record_vocabulary(record):
    vocabulary = dict(VOCABULARY)
    custom = record.get('customSymptoms', [])
    if not isinstance(custom, list) or len(custom) > 50:
        raise ValueError('At most 50 custom symptoms are allowed')
    for definition in custom:
        if not isinstance(definition, dict):
            raise ValueError('Invalid custom symptom')
        symptom_id = definition.get('id')
        if not isinstance(symptom_id, str) or not symptom_id.startswith('custom_') or len(symptom_id) > 100 or symptom_id in vocabulary:
            raise ValueError('Custom symptom requires a unique custom_ identifier')
        check_text(definition.get('label'), 'Symptom wording', 150)
        if not definition['label'].strip() or definition.get('domain') not in ('pain', 'bowel', 'urinary', 'systemic', 'sexual', 'extrapelvic') or type(definition.get('graded')) is not bool:
            raise ValueError('Invalid custom symptom definition')
        if definition.get('archived') is not None and type(definition['archived']) is not bool:
            raise ValueError('Invalid symptom archive state')
        if definition.get('mappedTo') and definition['mappedTo'] not in VOCABULARY:
            raise ValueError('Choose a supported clinical mapping')
        vocabulary[symptom_id] = definition
    return vocabulary


def check_text(value, field, limit):
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError(f'{field} must be text of at most {limit} characters')


def check_string_list(value, field):
    if not isinstance(value, list) or len(value) > 100 or any(not isinstance(v, str) or len(v) > 500 for v in value):
        raise ValueError(f'Invalid {field}')


def validate_report(report):
    if not isinstance(report, dict) or report.get('reviewed') is not True:
        raise ValueError('Report must be reviewed')
    check_text(report.get('patientNote', ''), 'Patient concerns', 3000)
    check_string_list(report.get('concerns', []), 'Main concerns')
    check_text(report.get('engineVersion'), 'Engine version', 100)
    findings = report.get('findings')
    if not isinstance(findings, list) or len(findings) > 1000:
        raise ValueError('Invalid saved findings')
    for finding in findings:
        if not isinstance(finding, dict):
            raise ValueError('Invalid saved finding')
        check_text(finding.get('id'), 'Finding ID', 200)
        test = finding.get('test')
        if test is not None:
            if not isinstance(test, dict):
                raise ValueError('Invalid saved method')
            check_text(test.get('name'), 'Method name', 300)
    start, end = report.get('windowStart'), report.get('windowEnd')
    if date.fromisoformat(start).isoformat() != start or date.fromisoformat(end).isoformat() != end or start > end:
        raise ValueError('Invalid report window')
    claims = report.get('claims')
    if not isinstance(claims, list) or len(claims) > 200:
        raise ValueError('Invalid report claims')
    for claim in claims:
        if not isinstance(claim, dict) or claim.get('section') not in ('period', 'concerns', 'findings', 'impact', 'medication', 'change', 'quality'):
            raise ValueError('Invalid claim')
        check_text(claim.get('text'), 'Claim', 5000)
        check_text(claim.get('id'), 'Claim ID', 200)
        values = claim.get('assertedValues')
        if not isinstance(values, dict) or any(type(v) not in (int, float) or not math.isfinite(v) for v in values.values()):
            raise ValueError('Invalid asserted values')
        evidence = claim.get('evidenceDates')
        if not isinstance(evidence, list) or len(evidence) > 10000:
            raise ValueError('Invalid evidence dates')
        for value in evidence:
            if date.fromisoformat(value).isoformat() != value:
                raise ValueError('Invalid evidence date')
