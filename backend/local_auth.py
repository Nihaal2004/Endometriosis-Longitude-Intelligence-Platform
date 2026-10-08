"""Local identity provider. Clinical ownership is resolved from server sessions."""
import hashlib
import hmac
import re
import secrets
import time
from uuid import uuid4

from medtrace_db.database import now

SESSION_HOURS = 12
IDLE_SECONDS = 30 * 60


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    hashed = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=32768, r=8, p=1, maxmem=128 * 1024 * 1024).hex()
    return f'scrypt${salt}${hashed}'


def verify_password(password, encoded):
    if not encoded or not isinstance(password, str) or len(password) > 128:
        return False
    _, salt, _ = encoded.split('$')
    return hmac.compare_digest(password_hash(password, salt), encoded)


def validate_password(password):
    if not isinstance(password, str) or not 10 <= len(password) <= 128:
        raise ValueError('Use a password between 10 and 128 characters')


def audit(db, subject, action):
    db.connection.execute('INSERT INTO audit_events(subject,action,recorded_at) VALUES (?,?,?)', (subject, action, now()))


def session_create(db, subject):
    token = secrets.token_urlsafe(32)
    timestamp = time.time()
    db.connection.execute('INSERT INTO sessions VALUES (?,?,?,?)', (digest(token), subject, timestamp + SESSION_HOURS * 3600, timestamp))
    return token


def session_resolve(db, token):
    if not token:
        return None
    timestamp = time.time()
    row = db.connection.execute('SELECT s.*,a.kind,a.username FROM sessions s JOIN accounts a ON a.subject=s.subject WHERE token_hash=?', (digest(token),)).fetchone()
    if row is None or row['expires_at'] < timestamp or row['last_seen'] + IDLE_SECONDS < timestamp:
        return None
    db.connection.execute('UPDATE sessions SET last_seen=? WHERE token_hash=?', (timestamp, digest(token)))
    return dict(row)


def csrf_token(token, key):
    return hmac.new(key, ('csrf:' + token).encode(), hashlib.sha256).hexdigest()


def register(db, body):
    username = body.get('username')
    if not isinstance(username, str):
        raise ValueError('Enter a username')
    username = username.strip().lower()
    if not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{2,39}', username):
        raise ValueError('Username must be 3–40 letters, numbers, dots, dashes, or underscores')
    password = body.get('password')
    validate_password(password)
    if body.get('storageConsent') is not True:
        raise ValueError('Local health storage consent is required')
    if type(body.get('analysisConsent')) is not bool:
        raise ValueError('Choose whether to allow analysis')
    display = body.get('displayName')
    if not isinstance(display, str):
        raise ValueError('Enter a display name')
    display = display.strip()
    if not display or len(display) > 80:
        raise ValueError('Enter a display name of at most 80 characters')
    recovery = secrets.token_urlsafe(24)
    subject, patient = str(uuid4()), str(uuid4())
    encoded = password_hash(password)
    with db.transaction():
        if db.connection.execute('SELECT 1 FROM accounts WHERE username=?', (username,)).fetchone():
            raise ValueError('That username is already registered on this device')
        db.connection.execute('INSERT INTO patients VALUES (?,?)', (patient, subject))
        db.connection.execute('INSERT INTO accounts VALUES (?,?,?,?,?,?)', (subject, username, encoded, digest(recovery), 'local', now()))
        for purpose, granted in (('health_storage', True), ('health_analysis', body['analysisConsent']), ('report_export', False)):
            db.connection.execute('INSERT INTO consent_events(patient_id,purpose,policy_version,granted,recorded_at) VALUES (?,?,?,?,?)', (patient, purpose, 'local-v1', int(granted), now()))
        record = {'profile': {'id': patient, 'displayName': display, 'diagnosisStatus': 'undiagnosed', 'enabledDomains': ['pain', 'bowel', 'urinary', 'systemic'], 'onboarded': False},
            'days': [], 'treatments': [], 'clinicalEvents': [], 'trackedSymptomIds': ['pelvic_pain', 'menstrual_pain', 'fatigue', 'bloating'], 'customSymptoms': [], 'medicationList': []}
        db.connection.execute('INSERT INTO record_revisions VALUES (?,?,?,?,?)', (patient, 1, str(uuid4()), db.vault.seal(record, f'record:{patient}:1'), now()))
        token = session_create(db, subject)
        audit(db, subject, 'account_registered')
    return token, recovery


def login(db, username, password):
    username = username.strip().lower() if isinstance(username, str) else ''
    row = db.connection.execute('SELECT * FROM accounts WHERE username=? AND kind=?', (username, 'local')).fetchone()
    # Perform scrypt even when the username does not exist.
    encoded = row['password_hash'] if row else 'scrypt$' + '0' * 32 + '$' + '0' * 128
    if not verify_password(password, encoded) or row is None:
        raise PermissionError('Username or password is incorrect')
    with db.transaction():
        token = session_create(db, row['subject'])
        audit(db, row['subject'], 'login')
    return token


def trial(db, record):
    subject = str(uuid4())
    db.provision_demo(subject, record, str(uuid4()))
    try:
        with db.transaction():
            db.connection.execute('INSERT INTO accounts VALUES (?,?,?,?,?,?)', (subject, None, None, None, 'trial', now()))
            token = session_create(db, subject)
            audit(db, subject, 'trial_started')
    except BaseException:
        db.connection.execute('DELETE FROM patients WHERE auth_subject=?', (subject,))
        raise
    return token


def cleanup_trials(db):
    timestamp = time.time()
    with db.transaction():
        db.connection.execute('DELETE FROM sessions WHERE expires_at<? OR last_seen<?', (timestamp, timestamp - IDLE_SECONDS))
        db.connection.execute("DELETE FROM patients WHERE auth_subject IN (SELECT subject FROM accounts WHERE kind='trial' AND NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.subject=accounts.subject))")
        db.connection.execute('DELETE FROM report_drafts WHERE expires_at<?', (timestamp,))
