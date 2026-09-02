# Spec 005 — Extract & commit HTTP API (sidecar wiring)

Status: **done** · Phase: 1 · Depends on: 002, 003, 004 · Blocks: 006 review UI, dashboard

## Intent
Expose the pure pipeline over the sidecar's HTTP API (CLAUDE.md §5: `api/` is a *thin* wrapper
that calls `pipeline.extract` and `db.commit`). This is the bridge the review screen needs:
the frontend POSTs a photo → gets a draft `Extraction` + the rectified image to overlay; the
user corrects it; the frontend POSTs the corrected `Extraction` → it's persisted.

No new domain logic — just transport + composition (build the `LabelReader`, open the DB).

## Inputs / Outputs
- **`POST /extract`** — multipart: `image` (file), `year`, `month` (form ints). →
  `200 { extraction: <Extraction JSON>, rows: int, rectified_png_b64: str }`.
  `422` if the grid can't be located (`GridNotFound`).
- **`POST /commit`** — JSON body: an `Extraction`. → `200 { month_id, year, month, entries,
  metrics, moments }` (the `MonthRecord`). `422` on contract/calendar validation failure.
- **`GET /health`** — unchanged (spec 001).

## Composition (thin wrapper only)
- `LabelReader` built via `readers.from_env()` (Gemini free tier default; `NullLabelReader`
  when no key). Injected through a FastAPI dependency so tests substitute a `StubLabelReader`
  (no network in the suite).
- DB: one `sqlite3` connection (single writer, §3) opened from `HC_DB_PATH` (default
  `habit.db` in the sidecar's cwd) and `migrate()`d on first use. Injected via a dependency so
  tests use `:memory:`.
- `.env` loaded on startup so `GEMNINI_KEY` / `LABEL_READER_*` are available.

## Acceptance criteria (testable — offline via dependency overrides)
1. `POST /extract` with a synthetic grid image + a `StubLabelReader` override returns `200`, an
   `Extraction` that validates, `rows` from CV, and a non-empty `rectified_png_b64`.
2. `POST /extract` on a blank image → `422` (GridNotFound surfaced, not a 500).
3. `POST /commit` with a valid `Extraction` (in-memory DB override) returns the `MonthRecord`
   counts and actually writes rows; a second identical commit is idempotent (spec 003).
4. `POST /commit` with an invalid `Extraction` (e.g. month 13) → `422`, nothing written.
5. `pipeline/` still imports no framework code; `api/` may import `fastapi`, `readers`, `db`
   (it's the wrapper). The suite runs with **no** network call.
6. `GET /health` still returns `{"status":"ok"}` (spec 001 unbroken).

## Edge cases
- **No API key:** `from_env()` → `NullLabelReader` → blank habit names in the draft (typed in
  review). `/extract` still succeeds.
- **Large photo / slow model:** the reader downscales + retries (spec 004); `/extract` may take
  ~tens of seconds on the free tier. Acceptable for a once-a-month action; the UI shows progress.
- **DB locked / single writer:** one connection, single-user, single process — no concurrency
  handling needed (§3).

## Out of scope (deferred)
- The **review & correct UI** itself (spec 006) — this spec only serves it.
- **Archiving** the raw photo + raw extraction JSON to disk on commit (paths exist in the
  schema; the file-copy step is a follow-up).
- **Auth / rate limiting** — loopback, single-user.
- **Dynamic DB path** in the OS app-data dir (packaging concern; `HC_DB_PATH` covers dev).
  `# ponytail: habit.db in cwd for dev; move to the OS app-data dir at packaging.`

## Verification runbook
1. `uv run pytest tests/test_api.py` → green, no network (AC 1–6).
2. Manual: `npm run tauri dev`, then `curl -F image=@docs/samplePhoto/...704.jpg -F year=2026
   -F month=8 http://127.0.0.1:8756/extract` → draft JSON with `rows=13`.
3. Full suite `uv run pytest` stays green.
