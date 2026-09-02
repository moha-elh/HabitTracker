# Spec 003 — SQLite schema + first migration + db/ access layer

Status: **done** · Phase: 1 · Depends on: 001, 002 · Blocks: 004, review-commit, dashboard

## Intent
Give the system durable storage. Create the SQLite schema (CLAUDE.md §6), a versioned
migration runner, and the `db/` access layer that is the **single writer** to the database
(§3). The layer turns a validated `Extraction` (spec 002) into persisted rows — the `commit`
half of the §5 interface — and does so **idempotently** keyed on `(year, month)` / `(day, …)`
so re-importing a month updates rows and never duplicates (§2, §10).

No HTTP route, no CV/OCR/LLM, no derived-metric queries here — just schema, migration, and
`commit`.

## Inputs / Outputs
- **Input:** a validated `Extraction` (from `pipeline.contract`), plus optional archive paths
  (`photo_path`, `raw_extraction_path`) and `notes_ocr_ok`.
- **Output:** persisted rows in the tables below, and a `MonthRecord` summarizing the write
  (`month_id`, `year`, `month`, and counts of entries/metrics/moments written).

## Schema (CLAUDE.md §6 — small and stable)
```
habits (id, name UNIQUE, kind, sort_order, active)
   -- kind: 'build' | 'eliminate'
months (id, year, month, imported_at, photo_path, raw_extraction_path, notes_ocr_ok)
   -- UNIQUE(year, month)
entries (id, month_id→months, day, habit_id→habits, done)   -- UNIQUE(month_id, day, habit_id)
metrics (id, month_id→months, day, sleep_hours)             -- UNIQUE(month_id, day)
moments (id, month_id→months, day, weekday, text, lang)     -- UNIQUE(month_id, day)
```
Foreign keys enforced (`PRAGMA foreign_keys = ON`); child tables cascade on month delete.
Everything derived (daily totals, monthly %, streaks) is **computed at query time**, never
stored (§6) — so none of it appears in the schema.

## Contract → rows mapping
- `Extraction.habits[]` → **upsert** `habits` by `name` (updates `kind`, `sort_order`, sets
  `active=1`). Entries reference the resulting `habit_id`.
- `Extraction.cells[]` → `entries`. `status: done → done=1`, `missed → done=0`,
  **`empty → no row`** (an unmarked cell is simply not tracked that day).
- `Extraction.sleep[]` → `metrics` (only rows where `hours` is not null).
- `Extraction.moments[]` → `moments`.
- Month identity `(year, month)` → upsert `months`; `imported_at` = now (UTC ISO-8601).

## Migration strategy
A **stdlib versioned-SQL runner** keyed on SQLite's `PRAGMA user_version` — no Alembic.
`MIGRATIONS` is an ordered list of SQL scripts; `migrate(conn)` applies those past the DB's
current `user_version` and advances it. Migration 1 is the full schema above.
`# ponytail: PRAGMA user_version runner — a single-user local file doesn't need Alembic; add it only if migrations get branchy.`

## Idempotency
`commit_extraction` runs in one transaction: upsert the `months` row, upsert habits, then
**delete-and-reinsert** that month's `entries`/`metrics`/`moments`. Delete-then-insert (rather
than per-row upsert) guarantees no stale rows survive when a re-import drops a habit or day —
the re-imported month fully replaces the old one. Correct and idempotent by construction.

## Acceptance criteria (testable)
1. `migrate()` on a fresh DB creates all five tables and sets `PRAGMA user_version = 1`;
   calling `migrate()` again is a no-op (no error, version unchanged).
2. `commit_extraction()` on a sample `Extraction` writes: one `months` row; `entries` for
   `done`/`missed` cells with correct `done` 0/1; **no** entry for `empty` cells; `metrics`
   for non-null sleep; `moments` rows. `habits` upserted with `kind`/`sort_order`.
3. **Idempotent:** committing the same `(year, month)` twice leaves row counts unchanged (no
   duplicates); changing a cell's status and re-committing updates that `entries.done`.
4. Re-import that **drops** a habit/day removes its stale child rows (delete-then-insert).
5. **Calendar validity:** an `Extraction` referencing a day past the month's length
   (e.g. day 31 in month 4) is rejected — the check spec 002 deferred to commit time.
6. `db/` imports only stdlib `sqlite3` (+ `pipeline.contract`); no `fastapi`/`tauri`/`http`
   (grep clean). Foreign keys are ON.
7. `tests/test_store.py` covers AC 1–5 and passes under `uv run pytest`.

## Edge cases
- **Empty extraction** (no cells/sleep/moments): the `months` row is still created; child
  tables get nothing. No special-casing.
- **Sleep `hours = null`:** skipped (no `metrics` row) — an entered-but-blank sleep value is
  absence, not zero.
- **Unknown/duplicate habit names:** duplicates are already rejected by the contract (spec
  002); the upsert keys on `name`, so the same habit across months maps to one `habits` row.
- **Concurrent writers:** out of scope — the sidecar is the single writer by design (§3).

## Out of scope (deferred)
- **Query / read layer** (daily totals, %, streaks, red-line cross-check, dashboard feeds) —
  computed at query time in a later spec, not here.
- **The HTTP route** exposing commit, and wiring `commit` into the §5 `pipeline` interface —
  later. This spec is the storage layer, callable directly.
- **Actual photo/JSON archiving** (moving files into an archive dir): this spec stores the
  *paths*; the file-copy step is a follow-up.
- **Alembic**, and any down-migrations.

## Verification runbook
1. `uv run pytest tests/test_store.py` → green (AC 1–5, 7).
2. `grep -rE "fastapi|tauri|uvicorn|http" services/pipeline/db/` → no hits (AC 6).
3. Full suite: `uv run pytest` (health + contract + store) → green.
