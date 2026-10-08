"""Local MedTrace application server. No cloud identity or storage services."""
import base64
from datetime import date
import hashlib
import hmac
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import secrets
import threading
import time
from uuid import UUID, uuid4

from medtrace_db import Database, Vault, Conflict, ConsentRequired
from medtrace_db.database import now, validate_record, check_text
from local_auth import register, login, trial, session_resolve, session_create, csrf_token, digest, audit, cleanup_trials, validate_password, verify_password, password_hash
from local_key import installation_key
from local_reports import compute_report, pdf_bytes

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'backend' / 'data'
ORIGINS = {f'http://{host}:{port}' for host in ('127.0.0.1', 'localhost') for port in (5173, 4173, 8765)}
THROTTLE = {}
LOCK = threading.Lock()


def reject_nonfinite(_value):
    raise ValueError('Non-finite numbers are not valid JSON')


class Handler(BaseHTTPRequestHandler):
    timeout = 75
    def log_message(self, *args):
        pass

    def respond(self, status, value, cookie=None):
        payload = json.dumps(value, allow_nan=False).encode()
        return self.send_bytes(status, payload, 'application/json', cookie=cookie)

    def send_bytes(self, status, payload, content_type, filename=None, cookie=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Length', str(len(payload)))
        if filename:
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        if cookie is not None:
            self.send_header('Set-Cookie', f'medtrace_session={cookie}; HttpOnly; SameSite=Strict; Path=/api; Max-Age={43200 if cookie else 0}')
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self): self.dispatch()
    def do_POST(self): self.dispatch()
    def do_PUT(self): self.dispatch()
    def do_DELETE(self): self.dispatch()

    def token(self):
        cookie = SimpleCookie()
        cookie.load(self.headers.get('Cookie', ''))
        return cookie['medtrace_session'].value if 'medtrace_session' in cookie else ''

    def auth_payload(self, db, token, recovery=None):
        session = session_resolve(db, token)
        patient = db._patient(session['subject'])
        consents = {}
        for purpose in ('health_storage', 'health_analysis', 'report_export'):
            row = db.connection.execute('SELECT granted FROM consent_events WHERE patient_id=? AND purpose=? ORDER BY sequence DESC LIMIT 1', (patient, purpose)).fetchone()
            consents[purpose] = bool(row and row['granted'])
        value = {'user': {'username': session['username'], 'kind': session['kind']}, 'csrfToken': csrf_token(token, self.server.key),
            'id': patient, 'consents': consents, **db.read_record(session['subject'])}
        if recovery:
            value['recoveryCode'] = recovery
        return value

    def throttle(self, username):
        key = digest(str(username).lower())
        timestamp = time.monotonic()
        with LOCK:
            for old in list(THROTTLE):
                THROTTLE[old] = [t for t in THROTTLE[old] if t > timestamp - 300]
                if not THROTTLE[old]: del THROTTLE[old]
            times = THROTTLE.setdefault(key, [])
            if len(times) >= 10 or sum(len(v) for v in THROTTLE.values()) >= 80:
                raise PermissionError('Too many attempts. Wait five minutes and try again.')
            times.append(timestamp)

    def dispatch(self):
        db = None
        try:
            if self.headers.get('Host') not in ('127.0.0.1:8765', 'localhost:8765'):
                return self.respond(403, {'error': 'This app accepts local connections only'})
            path = self.path.split('?')[0]
            if self.command == 'GET' and not path.startswith('/api/'):
                dist = ROOT / 'dist'
                entry = dist / 'index.html'
                sources = [ROOT / 'index.html', ROOT / 'vite.config.ts', ROOT / 'package.json', *list((ROOT / 'src').rglob('*')), *list((ROOT / 'shared').rglob('*'))]
                if not entry.is_file() or any(source.is_file() and source.stat().st_mtime > entry.stat().st_mtime for source in sources):
                    page = '<!doctype html><html><head><meta charset="utf-8"><title>MedTrace setup</title></head><body style="font-family:system-ui;max-width:620px;margin:80px auto;padding:24px"><h1>Refresh your local app build</h1><p>The interface has changed since the last build. Stop this server with Ctrl+C, then run:</p><pre>npm start</pre><p>This builds and serves the entire app in one terminal. Then open <a href="http://127.0.0.1:8765">http://127.0.0.1:8765</a>. You do not need a separate Vite server.</p></body></html>'
                    return self.send_bytes(503, page.encode('utf-8'), 'text/html; charset=utf-8')
                target = (dist / ('index.html' if path == '/' else path.lstrip('/'))).resolve()
                if target.is_relative_to(dist.resolve()) and target.is_file():
                    return self.send_bytes(200, target.read_bytes(), mimetypes.guess_type(target.name)[0] or 'application/octet-stream')
                return self.send_bytes(200, b'<h1>MedTrace local server</h1><p>Run npm run dev and <a href="http://127.0.0.1:5173">open MedTrace</a>, or build the app with npm run build.</p>', 'text/html; charset=utf-8')
            origin = self.headers.get('Origin')
            if origin and origin not in ORIGINS:
                return self.respond(403, {'error': 'Origin not allowed'})
            body = {}
            if self.command != 'GET':
                if self.headers.get('X-MedTrace-Client') != 'local-app' or not self.headers.get('Content-Type', '').startswith('application/json'):
                    return self.respond(403, {'error': 'Use the MedTrace application to make changes'})
                size = int(self.headers.get('Content-Length', 0))
                if not 0 < size <= 8_000_000:
                    return self.respond(413, {'error': 'Request exceeds the local upload limit'})
                body = json.loads(self.rfile.read(size), parse_constant=reject_nonfinite)
                if not isinstance(body, dict): raise ValueError('JSON object required')
            db = Database(DATA / 'medtrace.sqlite3', self.server.vault)
            cleanup_trials(db)
            if path == '/api/health':
                return self.respond(200, {'mode': 'local', 'storage': 'sqlite', 'auth': 'local'})
            token = self.token()
            session = session_resolve(db, token)
            if path == '/api/auth/session' and self.command == 'GET':
                return self.respond(200, self.auth_payload(db, token) if session else {'user': None})
            if path in ('/api/auth/register', '/api/auth/login', '/api/auth/recover', '/api/auth/trial') and self.command == 'POST':
                if session and not hmac.compare_digest(self.headers.get('X-CSRF-Token', ''), csrf_token(token, self.server.key)):
                    raise PermissionError('Refresh this page before switching sessions')
                self.throttle(body.get('username', 'trial'))
                recovery = None
                if path.endswith('/register'):
                    new_token, recovery = register(db, body)
                elif path.endswith('/login'):
                    new_token = login(db, body.get('username'), body.get('password'))
                elif path.endswith('/trial'):
                    if body.get('accepted') is not True: raise ValueError('Accept the trial explanation first')
                    validate_record(body['record'])
                    new_token = trial(db, body['record'])
                else:
                    username = str(body.get('username', '')).strip().lower()
                    row = db.connection.execute("SELECT * FROM accounts WHERE username=? AND kind='local'", (username,)).fetchone()
                    if row is None or not hmac.compare_digest(row['recovery_hash'], digest(str(body.get('recoveryCode', '')))):
                        raise PermissionError('Username or recovery code is incorrect')
                    validate_password(body.get('password'))
                    recovery = secrets.token_urlsafe(24)
                    with db.transaction():
                        db.connection.execute('UPDATE accounts SET password_hash=?,recovery_hash=? WHERE subject=?', (password_hash(body['password']), digest(recovery), row['subject']))
                        db.connection.execute('DELETE FROM sessions WHERE subject=?', (row['subject'],))
                        new_token = session_create(db, row['subject'])
                        audit(db, row['subject'], 'account_recovered')
                if session:
                    db.connection.execute('DELETE FROM sessions WHERE token_hash=?', (digest(token),))
                return self.respond(200, self.auth_payload(db, new_token, recovery), cookie=new_token)
            if path.startswith('/api/shared/') and self.command == 'GET':
                grant = db.connection.execute('SELECT * FROM share_grants WHERE token_hash=? AND revoked=0 AND expires_at>?', (digest(path.rsplit('/', 1)[-1]), time.time())).fetchone()
                if grant is None: return self.respond(404, {'error': 'This visit link has expired or been revoked'})
                row = db.connection.execute('SELECT auth_subject FROM patients WHERE id=?', (grant['patient_id'],)).fetchone()
                db._require_consent(grant['patient_id'], 'report_export')
                report = db.read_report(row['auth_subject'], grant['report_id'])
                audit(db, row['auth_subject'], 'visit_link_accessed')
                return self.send_bytes(200, pdf_bytes(report), 'application/pdf', 'medtrace-visit-report.pdf')
            if session is None:
                return self.respond(401, {'error': 'Please sign in. Your session may have expired.'}, cookie='')
            subject = session['subject']
            if self.command != 'GET' and not hmac.compare_digest(self.headers.get('X-CSRF-Token', ''), csrf_token(token, self.server.key)):
                return self.respond(403, {'error': 'Session check failed. Refresh the app before continuing.'})
            if path == '/api/auth/ping' and self.command == 'GET':
                return self.respond(200, {'ok': True})
            if path == '/api/auth/logout' and self.command == 'POST':
                with db.transaction():
                    audit(db, subject, 'logout')
                    if session['kind'] == 'trial': db.connection.execute('DELETE FROM patients WHERE auth_subject=?', (subject,))
                    else: db.connection.execute('DELETE FROM sessions WHERE token_hash=?', (digest(token),))
                return self.respond(200, {'ok': True}, cookie='')
            if path == '/api/record' and self.command == 'GET':
                return self.respond(200, self.auth_payload(db, token))
            if path == '/api/record' and self.command == 'PUT':
                db.save_record(subject, body['record'], expected_revision=body['revision'], request_id=body['requestId'])
                audit(db, subject, 'record_saved')
                return self.respond(200, self.auth_payload(db, token))
            if path == '/api/trial/scenario' and self.command == 'POST':
                if session['kind'] != 'trial': raise PermissionError('Example records are only available in a trial session')
                record = body['record']; record['profile']['id'] = db._patient(subject)
                current = db.read_record(subject)
                db.save_record(subject, record, expected_revision=current['revision'], request_id=body['requestId'])
                return self.respond(200, self.auth_payload(db, token))
            if path == '/api/consents' and self.command == 'POST':
                db.record_consent(subject, body['purpose'], 'local-v1', body['granted'])
                audit(db, subject, 'consent_updated')
                return self.respond(200, self.auth_payload(db, token))
            if path == '/api/reports/preview' and self.command == 'POST':
                current = db.read_record(subject, analysis=True)
                patient = db._patient(subject)
                db._require_consent(patient, 'report_export')
                if current['revision'] != body['revision']: raise Conflict('Record changed; reload before preparing a report')
                report = compute_report(current['record'], body['scope'])
                check_text(body.get('patientNote', ''), 'Visit questions', 3000)
                if body.get('visitDate'): date.fromisoformat(body['visitDate'])
                report.update({'patientNote': body.get('patientNote', ''), 'visitDate': body.get('visitDate', ''), 'recordRevision': current['revision']})
                draft_id = str(uuid4())
                db._require_consent(patient, 'health_analysis')
                db._require_consent(patient, 'report_export')
                db.connection.execute('INSERT INTO report_drafts VALUES (?,?,?,?,?)', (draft_id, patient, current['revision'], db.vault.seal(report, f'draft:{patient}:{draft_id}'), time.time() + 3600))
                audit(db, subject, 'report_previewed')
                return self.respond(200, {'draftId': draft_id, 'report': report})
            if path == '/api/reports' and self.command == 'POST':
                if body.get('reviewed') is not True: raise ValueError('Review the report before saving')
                report_id, saved = db.approve_draft(subject, body['draftId'], body['requestId'])
                audit(db, subject, 'report_approved')
                return self.respond(201, {'id': report_id, 'report': saved})
            if path == '/api/reports' and self.command == 'GET':
                return self.respond(200, db.list_reports(subject))
            if path.startswith('/api/reports/') and self.command == 'GET':
                parts = path.strip('/').split('/')
                report = db.read_report(subject, parts[2])
                if report is None: return self.respond(404, {'error': 'Report not found'})
                audit(db, subject, 'report_opened')
                if len(parts) == 4 and parts[3] == 'pdf':
                    db._require_consent(db._patient(subject), 'report_export')
                    return self.send_bytes(200, pdf_bytes(report), 'application/pdf', 'medtrace-visit-report.pdf')
                return self.respond(200, report)
            if path == '/api/shares' and self.command == 'POST':
                db._require_consent(db._patient(subject), 'report_export')
                report = db.read_report(subject, body['reportId'])
                if report is None: raise ValueError('Report not found')
                hours = body.get('hours', 24)
                if type(hours) is not int or not 1 <= hours <= 168: raise ValueError('Choose an expiry from 1 to 168 hours')
                share = secrets.token_urlsafe(32)
                db.connection.execute('INSERT INTO share_grants VALUES (?,?,?,?,?,?)', (digest(share), db._patient(subject), body['reportId'], time.time() + hours * 3600, 0, now()))
                audit(db, subject, 'visit_link_created')
                return self.respond(201, {'url': f'/api/shared/{share}', 'expiresInHours': hours})
            if path == '/api/shares' and self.command == 'GET':
                return self.respond(200, [dict(r) for r in db.connection.execute('SELECT token_hash,report_id,expires_at,revoked,created_at FROM share_grants WHERE patient_id=?', (db._patient(subject),))])
            if path == '/api/shares/revoke' and self.command == 'POST':
                db.connection.execute('UPDATE share_grants SET revoked=1 WHERE patient_id=? AND token_hash=?', (db._patient(subject), body['id']))
                audit(db, subject, 'visit_link_revoked')
                return self.respond(200, {'ok': True})
            if path == '/api/audit' and self.command == 'GET':
                return self.respond(200, [dict(r) for r in db.connection.execute('SELECT action,recorded_at FROM audit_events WHERE subject=? ORDER BY id DESC LIMIT 100', (subject,))])
            if path == '/api/export' and self.command == 'GET':
                record = db.read_record(subject)
                reports = [db.read_report(subject, r['id']) for r in db.list_reports(subject)] if self.auth_payload(db, token)['consents']['report_export'] else []
                audit(db, subject, 'data_exported')
                patient = db._patient(subject)
                revisions = [{'revision': r['revision'], 'recordedAt': r['recorded_at'], 'record': db.vault.open(r['payload'], f'record:{patient}:{r["revision"]}')} for r in db.connection.execute('SELECT * FROM record_revisions WHERE patient_id=? ORDER BY revision', (patient,))]
                documents = [db.vault.open(r['payload'], f'attachment:{patient}:{r["id"]}') for r in db.connection.execute('SELECT * FROM attachments WHERE patient_id=?', (patient,))]
                permissions = [dict(r) for r in db.connection.execute('SELECT purpose,policy_version,granted,recorded_at FROM consent_events WHERE patient_id=? ORDER BY sequence', (patient,))]
                history = [dict(r) for r in db.connection.execute('SELECT action,recorded_at FROM audit_events WHERE subject=? ORDER BY id', (subject,))]
                export = {'format': 'medtrace-local-export-v1', 'record': record['record'], 'revisions': revisions, 'reports': reports, 'documents': documents, 'permissions': permissions, 'activity': history}
                return self.send_bytes(200, json.dumps(export, ensure_ascii=False).encode(), 'application/json', 'medtrace-data.json')
            if path == '/api/privacy/erase-domain' and self.command == 'POST':
                if body.get('confirmation') != 'ERASE': raise ValueError('Type ERASE to confirm')
                row = db.connection.execute('SELECT password_hash FROM accounts WHERE subject=?', (subject,)).fetchone()
                if session['kind'] == 'local' and not verify_password(body.get('password'), row['password_hash']):
                    raise PermissionError('Confirm deletion with your password')
                db.erase_domain(subject, body['domain'], body['revision'])
                audit(db, subject, 'domain_data_erased')
                return self.respond(200, self.auth_payload(db, token))
            if path == '/api/account/password' and self.command == 'POST':
                row = db.connection.execute('SELECT password_hash FROM accounts WHERE subject=?', (subject,)).fetchone()
                if session['kind'] != 'local' or not verify_password(body.get('currentPassword'), row['password_hash']): raise PermissionError('Current password is incorrect')
                validate_password(body.get('password'))
                with db.transaction():
                    db.connection.execute('UPDATE accounts SET password_hash=? WHERE subject=?', (password_hash(body['password']), subject))
                    db.connection.execute('DELETE FROM sessions WHERE subject=?', (subject,))
                    new_token = session_create(db, subject)
                    audit(db, subject, 'password_changed')
                return self.respond(200, self.auth_payload(db, new_token), cookie=new_token)
            if path == '/api/account' and self.command == 'DELETE':
                row = db.connection.execute('SELECT password_hash FROM accounts WHERE subject=?', (subject,)).fetchone()
                if session['kind'] == 'local' and not verify_password(body.get('password'), row['password_hash']): raise PermissionError('Confirm deletion with your password')
                if body.get('confirmation') != 'DELETE': raise ValueError('Type DELETE to confirm')
                with db.transaction(): db.connection.execute('DELETE FROM patients WHERE auth_subject=?', (subject,))
                return self.respond(200, {'ok': True}, cookie='')
            if path.startswith('/api/attachments'):
                return self.attachments(db, subject, path, body)
            return self.respond(404, {'error': 'Route not found'})
        except Conflict as exc: self.respond(409, {'error': str(exc)})
        except ConsentRequired as exc: self.respond(403, {'error': str(exc)})
        except PermissionError as exc: self.respond(403, {'error': str(exc)})
        except (ValueError, KeyError, TypeError, OverflowError) as exc: self.respond(400, {'error': str(exc)})
        except ImportError: self.respond(503, {'error': 'Install backend requirements before using this feature'})
        except RuntimeError as exc: self.respond(503, {'error': str(exc)})
        except Exception: self.respond(500, {'error': 'Local operation failed. Your existing records have not been cleared.'})
        finally:
            if db: db.close()

    def attachments(self, db, subject, path, body):
        patient = db._patient(subject)
        if path == '/api/attachments' and self.command == 'POST':
            db._require_consent(patient, 'health_storage')
            record = db.read_record(subject)['record']
            if not any(e['id'] == body['eventId'] for e in record['clinicalEvents']): raise ValueError('Select an existing healthcare event')
            check_text(body['filename'], 'Filename', 200)
            payload = base64.b64decode(body['content'], validate=True)
            if not 0 < len(payload) <= 5_000_000: raise ValueError('Maximum document size is 5 MB')
            valid = (body['mime'] == 'application/pdf' and payload.startswith(b'%PDF-')) or (body['mime'] == 'image/png' and payload.startswith(b'\x89PNG\r\n\x1a\n')) or (body['mime'] == 'image/jpeg' and payload.startswith(b'\xff\xd8\xff'))
            if not valid: raise ValueError('Upload a PDF, PNG, or JPEG document')
            identifier = str(uuid4())
            db.connection.execute('INSERT INTO attachments VALUES (?,?,?,?,?)', (identifier, patient, body['eventId'], db.vault.seal(body, f'attachment:{patient}:{identifier}'), now()))
            audit(db, subject, 'document_uploaded')
            return self.respond(201, {'id': identifier})
        if path == '/api/attachments' and self.command == 'GET':
            result = []
            for row in db.connection.execute('SELECT * FROM attachments WHERE patient_id=?', (patient,)):
                metadata = db.vault.open(row['payload'], f'attachment:{patient}:{row["id"]}')
                result.append({'id': row['id'], 'eventId': row['event_id'], 'filename': metadata['filename'], 'mime': metadata['mime']})
            return self.respond(200, result)
        identifier = str(UUID(path.rsplit('/', 1)[-1]))
        row = db.connection.execute('SELECT * FROM attachments WHERE patient_id=? AND id=?', (patient, identifier)).fetchone()
        if row is None: return self.respond(404, {'error': 'Document not found'})
        if self.command == 'DELETE':
            db._require_consent(patient, 'health_storage')
            db.connection.execute('DELETE FROM attachments WHERE id=?', (identifier,))
            audit(db, subject, 'document_deleted')
            return self.respond(200, {'ok': True})
        if self.command == 'GET':
            value = db.vault.open(row['payload'], f'attachment:{patient}:{identifier}')
            extension = {'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg'}[value['mime']]
            return self.send_bytes(200, base64.b64decode(value['content']), value['mime'], f'medtrace-document.{extension}')
        return self.respond(405, {'error': 'Method not allowed'})


def main():
    DATA.mkdir(exist_ok=True)
    key = installation_key(DATA)
    server = ThreadingHTTPServer(('127.0.0.1', 8765), Handler)
    server.key = key
    server.vault = Vault({1: key}, 1)
    print('MedTrace: http://127.0.0.1:8765 — leave this terminal open; Ctrl+C stops the app.', flush=True)
    stop = threading.Event()
    def maintenance():
        while not stop.wait(60):
            db = None
            try:
                db = Database(DATA / 'medtrace.sqlite3', server.vault)
                cleanup_trials(db)
            except Exception:
                pass
            finally:
                if db: db.close()
    worker = threading.Thread(target=maintenance, daemon=True)
    worker.start()
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally:
        stop.set()
        server.server_close()


if __name__ == '__main__': main()
