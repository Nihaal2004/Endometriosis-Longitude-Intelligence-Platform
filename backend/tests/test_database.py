from uuid import uuid4

import pytest
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from medtrace_db import Database, Vault, Conflict, ConsentRequired


@pytest.fixture
def setup_db(tmp_path):
    key = AESGCM.generate_key(bit_length=256)
    vault = Vault({1: key}, 1)
    path = tmp_path / 'health.sqlite3'
    db = Database(path, vault)
    subject = str(uuid4())
    patient = db.create_patient(subject)
    yield db, subject, patient, vault, path
    db.close()


def entry():
    return {'date': '2026-10-02', 'logged': True, 'bleeding': 'none', 'impact': 2,
            'symptoms': {'pelvic_pain': {'state': 'present', 'severity': 7},
                         'fatigue': {'state': 'unknown'}, 'back_pain': {'state': 'absent'}},
            'note': 'synthetic-private-note'}


def allow(db, subject):
    db.record_consent(subject, 'health_storage', 'v1', True)


def test_restart_encryption_and_missing_days(setup_db):
    db, subject, patient, vault, path = setup_db
    allow(db, subject)
    db.save_profile(subject, {'diagnosisStatus': 'suspected'})
    db.save_day(subject, entry(), expected_revision=0, request_id=str(uuid4()))
    reopened = Database(path, vault)
    try:
        assert reopened.create_patient(subject) == patient
        assert reopened.read_profile(subject)['diagnosisStatus'] == 'suspected'
        result = reopened.read_days(subject, '2026-10-01', '2026-10-03')
        assert result == [{'revision': 1, 'entry': entry()}]
        assert b'synthetic-private-note' not in path.read_bytes()
        assert b'pelvic_pain' not in path.read_bytes()
    finally:
        reopened.close()


def test_consent_withdrawal_and_separate_analysis(setup_db):
    db, subject, _, _, _ = setup_db
    with pytest.raises(ConsentRequired):
        db.save_day(subject, entry(), expected_revision=0, request_id=str(uuid4()))
    allow(db, subject)
    db.save_day(subject, entry(), expected_revision=0, request_id=str(uuid4()))
    with pytest.raises(ConsentRequired):
        db.analysis_days(subject, '2026-10-01', '2026-10-03')
    db.record_consent(subject, 'health_analysis', 'v1', True)
    assert db.analysis_days(subject, '2026-10-01', '2026-10-03') == [entry()]
    db.record_consent(subject, 'health_analysis', 'v1', False)
    with pytest.raises(ConsentRequired):
        db.analysis_days(subject, '2026-10-01', '2026-10-03')
    db.record_consent(subject, 'health_storage', 'v1', False)
    with pytest.raises(ConsentRequired):
        db.save_profile(subject, {'ageRange': '20-29'})
    # Withdrawal stops processing; patient may still read their own existing data.
    assert db.read_profile(subject) is None


def test_retry_conflict_and_revision_history(setup_db):
    db, subject, patient, _, _ = setup_db
    allow(db, subject)
    request = str(uuid4())
    assert db.save_day(subject, entry(), expected_revision=0, request_id=request) == 1
    assert db.save_day(subject, entry(), expected_revision=0, request_id=request) == 1
    changed = {**entry(), 'note': 'corrected'}
    with pytest.raises(Conflict):
        db.save_day(subject, changed, expected_revision=0, request_id=request)
    with pytest.raises(Conflict):
        db.save_day(subject, changed, expected_revision=0, request_id=str(uuid4()))
    assert db.save_day(subject, changed, expected_revision=1, request_id=str(uuid4())) == 2
    assert db.read_days(subject, '2026-10-02', '2026-10-02')[0]['entry'] == changed
    assert db.connection.execute('SELECT COUNT(*) FROM day_revisions WHERE patient_id=?',
                                 (patient,)).fetchone()[0] == 3


def test_patient_isolation(setup_db):
    db, subject, _, _, _ = setup_db
    allow(db, subject)
    db.save_profile(subject, {'ageRange': '20-29'})
    db.save_day(subject, entry(), expected_revision=0, request_id=str(uuid4()))
    other = str(uuid4())
    db.create_patient(other)
    assert db.read_days(other, '2026-10-01', '2026-10-03') == []
    assert db.read_profile(other) is None
    with pytest.raises(PermissionError):
        db.read_profile(str(uuid4()))


@pytest.mark.parametrize('observation', [
    {'state': 'absent', 'severity': 7}, {'state': 'unknown', 'severity': 0},
    {'state': 'present', 'severity': 11}, {'state': 'present', 'severity': True},
    {'state': 'present', 'severity': 0}, {},
])
def test_invalid_observations(setup_db, observation):
    db, subject, _, _, _ = setup_db
    allow(db, subject)
    day = {**entry(), 'symptoms': {'pain': observation}}
    with pytest.raises(ValueError):
        db.save_day(subject, day, expected_revision=0, request_id=str(uuid4()))


def test_crypto_tampering_substitution_and_key_versions():
    key = AESGCM.generate_key(bit_length=256)
    vault = Vault({1: key}, 1)
    value = {'note': 'private'}
    envelope = vault.seal(value, 'patient-a:day:1')
    assert vault.open(envelope, 'patient-a:day:1') == value
    assert vault.seal(value, 'patient-a:day:1') != envelope
    with pytest.raises(InvalidTag):
        vault.open(envelope, 'patient-b:day:1')
    with pytest.raises(InvalidTag):
        vault.open(envelope[:-1] + bytes([envelope[-1] ^ 1]), 'patient-a:day:1')
    rotating = Vault({1: key, 2: AESGCM.generate_key(bit_length=256)}, 2)
    assert rotating.open(envelope, 'patient-a:day:1') == value
    assert int.from_bytes(rotating.seal(value, 'new')[:4], 'big') == 2
    with pytest.raises(KeyError):
        Vault({2: AESGCM.generate_key(bit_length=256)}, 2).open(envelope, 'patient-a:day:1')


def test_migration_version_and_future_schema(tmp_path):
    vault = Vault({1: AESGCM.generate_key(bit_length=256)}, 1)
    path = tmp_path / 'migration.sqlite3'
    db = Database(path, vault)
    assert db.connection.execute('PRAGMA user_version').fetchone()[0] == 3
    db.connection.execute('PRAGMA user_version=99')
    db.close()
    with pytest.raises(RuntimeError):
        Database(path, vault)
