# Local backend

Normal startup is documented in the [root README](../README.md): `npm start` builds
the frontend and runs `server.py` on 127.0.0.1:8765. `npm run api` is the same
build-and-serve workflow; it is not a separate frontend launcher.

For backend-only development after dependencies are installed:

```powershell
backend\.venv\Scripts\python.exe backend/server.py
```

The backend-only command does not rebuild `dist`. Use Vite in a separate terminal
for hot reload, or return to `npm start` for normal one-terminal operation.

| Documentation | Purpose |
|---|---|
| [Architecture and API](../docs/ARCHITECTURE.md) | Auth, routes, reports, documents, request boundaries |
| [SQLite design](../docs/SQLITE_DESIGN.md) | Schema v3, consent, transactions, encryption, erasure |
| [Development](../docs/DEVELOPMENT.md) | Setup, troubleshooting, commands, GitHub preparation |

Runtime data and the DPAPI installation key are in ignored `backend/data/`.
Do not commit or delete the key to reset an existing database. Local accounts use
`local_auth.py`; Supabase is not currently configured. Windows startup requires no
`.env`. For non-Windows key handling, see the architecture guide.
