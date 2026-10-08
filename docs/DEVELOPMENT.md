# Development and repository guide

## Normal startup

Follow the [root README](../README.md) to install dependencies. From the repository
root, run:

```powershell
npm start
```

`npm start` delegates to `npm run api`, which runs the TypeScript/Vite build and then
starts the Python server. Open http://127.0.0.1:8765 and leave the terminal running.
This is the recommended workflow for using or presenting the application.

## Hot-reload development

Hot reload is optional and needs two terminals. Start only the backend in the first:

```powershell
backend\.venv\Scripts\python.exe backend/server.py
```

Start Vite in the second:

```powershell
npm run dev
```

Open http://127.0.0.1:5173. Vite serves current source and proxies `/api` to 8765.
Do not use `npm run dev` as a substitute for the backend. For one-terminal use,
return to `npm start`. No extra launcher dependency is required.

## Commands

| Command | Effect |
|---|---|
| `npm start` | Build and serve the complete local application |
| `npm run api` | Same build-and-serve workflow |
| `npm run build` | TypeScript checking and production frontend build |
| `npm run dev` | Frontend hot-reload server only, port 5173 |
| `npm run preview` | Built frontend preview only, port 4173; needs backend |
| `npm test` | Existing TypeScript engine/UI test suite |
| `npm run test:watch` | Watch-mode tests |
| `npm run eval` | Regenerate synthetic engine evaluation metrics |

The npm launch commands currently use the Windows virtual-environment path.
A non-Windows developer must invoke their Python environment directly and configure
`MEDTRACE_LOCAL_KEY` as documented in [architecture](ARCHITECTURE.md).

## Review and verification

Static type checking without emitting files:

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Backend repository suite:

```powershell
backend\.venv\Scripts\python.exe -m pytest backend/tests
```

Existing synthetic metrics in `src/eval/results/metrics.json` and the research log
are historical engine evidence. They are not results from an end-to-end validation
of the current account/report workflow. Static checks do not establish runtime
correctness. Functional verification should cover the criteria in [PRD](PRD.md),
especially account isolation, report scope, stale edits, purpose withdrawal,
trial expiry, erasure, and document ownership.

## Troubleshooting

| Symptom | Action |
|---|---|
| Old demo-patient screen | Stop the local server and run `npm start`, then reload 8765. A backend-only launch does not rebuild the interface. |
| Setup page says the build is stale/missing | Run `npm start` to regenerate `dist` from current source. |
| Port 5173 already in use | A Vite process is already running. Stop it with Ctrl+C before starting another, or use the normal 8765 workflow. |
| Port 8765 already in use | Stop the existing MedTrace API in its terminal before restarting. Do not terminate unrelated processes. |
| API unavailable / proxy connection failure | Ensure the Python server is running on 8765; Vite alone cannot provide accounts or storage. |
| 403 during session startup | Use the documented loopback URL and restart an older API/proxy process. Read the app's error text for the rejected boundary. |
| Session expired | Sign in again. Unsaved drafts are not preserved across sign-out or reload. |
| Record conflict | Reload the saved record and reapply changes. Another tab may have saved a newer revision. |
| Report permission disabled | Enable analysis and report permissions in Settings. |
| Preview expired or record changed | Generate and review a fresh preview before approving. |
| PDF generation dependency error | Install `backend/requirements.txt` into `backend/.venv`. |
| Report runner unavailable | Run `npm ci` and confirm Node.js is installed. Reports need the local `tsx` package. |
| Missing/invalid encryption key | Restore the original key and matching database. Password recovery cannot replace the installation key. |

Changing Python files requires restarting the server. Normal startup rebuilds the
frontend; Vite updates frontend source during hot-reload development.

## Files for GitHub

Commit application source, `shared/symptoms.json`, dependency manifests/lockfile,
backend requirements and tests, and current documentation. `.gitignore` excludes
runtime databases, `backend/data/` keys/documents, `.env` files, virtual environments,
Node dependencies, and generated frontend builds.

Do not include personal JSON exports or clinical PDFs. Original project proposal,
study, and presentation materials are separate research artifacts; review them
before including them in a commit. Generated TypeScript build caches (`*.tsbuildinfo`) are also ignored and are not
source files. The previously tracked cache has been removed.

Before committing, inspect changes rather than assuming the working tree contains
only documentation:

```powershell
git status --short
git diff --check
git diff --stat
```

After reviewing and selecting the files you intend to publish, commit them and push
the existing branch to your configured GitHub remote. This documentation update
does not create a commit, change branches, or push the repository.
