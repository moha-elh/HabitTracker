# Spec 001 — Monorepo scaffold + health-check round-trip

Status: **draft** · Phase: 1 · Depends on: none · Blocks: 002+

## Intent
Stand up the empty repo as the monorepo described in CLAUDE.md §4/§11, and prove the
core architecture works with the smallest possible end-to-end slice: the React UI, running
inside the Tauri desktop shell, fetches a status from the Python sidecar over loopback HTTP
and displays it. The Tauri host owns the sidecar's lifecycle (spawn on launch, kill on exit).

No domain logic (grid/CV/sleep/notes/DB) is built here — this spec only establishes the
skeleton and the communication path everything else will ride on. Getting this green is the
Phase-1 gate for all later specs.

## Inputs / Outputs
- **Input:** none at runtime. Build-time inputs are the toolchain (Node, Rust/MSVC, uv +
  Python 3.12) and `docs/design_system/tokens.css` (adopted as the frontend theme source).
- **Output — the health contract (the only cross-boundary agreement in this spec):**
  ```
  GET /health  ->  200  { "status": "ok" }
  ```
  Served by the sidecar on `127.0.0.1:<port>`. The frontend renders the returned `status`
  string verbatim — it must not hardcode "ok".

## Repo layout produced (CLAUDE.md §11)
```
apps/desktop/
  src/                 # React + TS (Vite)
  src-tauri/           # Rust host, sidecar spawn config
services/pipeline/
  pipeline/            # PURE module — empty package here (the §5 boundary starts clean)
  api/                 # FastAPI wrapper — /health lives here
  db/                  # placeholder for spec 003
  tests/
docs/specs/            # this file and successors
.gitignore
```

## Components
1. **Sidecar** (`services/pipeline`, Python 3.12 via uv): FastAPI app exposing `GET /health`.
   Bound to `127.0.0.1` on a port from `--port` / `HC_SIDECAR_PORT` (default `8756`). CORS
   permits the Vite dev origin. `pipeline/` is an importable package with **no** framework
   imports.
2. **Desktop app** (`apps/desktop`): Vite React-TS + Tailwind (theme from `tokens.css`,
   2a fonts Grand Hotel + Lato). Tauri v2 Rust host that, on startup, spawns the sidecar and
   passes it the chosen loopback port; exposes that port to the frontend via a Tauri command;
   terminates the sidecar on window close.
3. **Round-trip:** `App.tsx` asks Tauri for the port, fetches `/health`, renders `status`.

## Acceptance criteria (testable)
1. `cargo --version`, `uv --version`, and `node --version` all resolve (prereqs present).
2. Sidecar standalone: `uv run uvicorn api.main:app --port 8756` then
   `curl 127.0.0.1:8756/health` returns exactly `{"status":"ok"}` with HTTP 200.
3. `npm run tauri dev` (in `apps/desktop`) opens a native window that displays `ok`, fetched
   live from the sidecar (verified by temporarily changing the sidecar's returned string and
   seeing the window follow).
4. Closing the app window leaves **no** orphaned Python/uvicorn process (Tauri killed it).
5. Boundary holds: `services/pipeline/pipeline/` contains no import of `fastapi`, `tauri`,
   `uvicorn`, or `http` (grep is clean).
6. Repo is a git repo with a `.gitignore` covering `node_modules/`, `target/`, `.venv/`,
   `__pycache__/`, `dist/`.

## Edge cases
- **Sidecar not ready when the UI fetches:** the frontend retries `/health` a few times with
  a short backoff before showing an error, since the Python process may still be booting when
  the window opens.
- **Port already in use:** default `8756` may be taken. In scope: honor `HC_SIDECAR_PORT`
  override so a collision is resolvable without code changes. Dynamic free-port assignment is
  out of scope (noted below).
- **uv/Python 3.12 absent:** `uv python pin 3.12` must trigger uv to install it; document the
  one command rather than assuming it's present.

## Out of scope (deferred to later specs / follow-ups)
- **PyInstaller-freezing** the sidecar into a packaged Tauri sidecar binary. Dev spawns
  `uv run uvicorn` directly; freezing happens before the first packaged build.
  `# ponytail: dev spawns uv run; freeze before packaging.`
- **Dynamic OS-assigned free port** (start with fixed default + env override).
- The extraction **contract** (spec 002), **SQLite schema** (spec 003), **grid extraction**
  (spec 004), and any dashboard UI. This spec builds none of the domain.

## Verification runbook
1. `cargo --version` (gate — already verified present).
2. Build the sidecar, run standalone, `curl` `/health` → `{"status":"ok"}`.
3. `npm run tauri dev` → window shows `ok`.
4. Flip the sidecar's return value → window reflects the change → revert.
5. Close window → check no lingering python process (`Get-Process python*`).
6. `grep -rE "fastapi|tauri|uvicorn|http" services/pipeline/pipeline/` → no hits.
