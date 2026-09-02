# Spec 002 — Extraction contract (Pydantic + TS mirror)

Status: **done** · Phase: 1 · Depends on: 001 · Blocks: 003, 004, review UI, dashboard

## Intent
Define the **extraction contract** — the single cross-boundary agreement between the Python
pipeline and the React frontend (CLAUDE.md §5). This is the spine of the system: `extract()`
returns it as a draft, the review screen edits it, and `commit()` persists it. Define it once,
version it, and mirror it to TypeScript so both sides agree on this schema and nothing else.

This spec builds only the **data shapes and their validation** — no extraction logic, no HTTP
route, no DB. It is the vocabulary every later spec speaks.

## Inputs / Outputs
- **Input:** none at runtime. This is a type/contract definition.
- **Output:** an `Extraction` object — the draft produced from one month's photo, before any
  persistence. Shape (authoritative in `contract.py`; mirrored in `contract.ts`):
  ```
  Extraction {
    contract_version: int           # == CONTRACT_VERSION; guards schema drift
    year:  int                      # e.g. 2026
    month: int  (1..12)
    habits:  Habit[]                # the grid's row labels, in order
    cells:   Cell[]                 # one per (day, habit) sampled from the grid
    sleep:   SleepReading[]         # independent metric; may be empty (manual in Phase 1)
    moments: Moment[]               # one free-text line per day; may be empty
    flags:   DayFlag[]              # QA signals surfaced to the review UI
  }

  Habit        { name: str, kind: 'build'|'eliminate' = 'build', sort_order: int }
  Cell         { day: 1..31, habit: str, status: 'done'|'missed'|'empty', confidence: 0..1 }
  SleepReading { day: 1..31, hours: float|null, confidence: 0..1 }
  Moment       { day: 1..31, weekday: str|null, text: str, lang: str|null }
  DayFlag      { day: 1..31, reason: str }     # e.g. "grid total 8 != drawn red line 6"
  ```
  Enums: `HabitKind = build|eliminate`, `CellStatus = done|missed|empty`.

## Domain rationale (why these fields, from CLAUDE.md §2/§6)
- Extraction targets collapse to exactly three — **grid** (`cells`), **sleep** (`sleep`),
  **notes** (`moments`) — plus the **habits** that label the grid rows. Everything else
  (daily totals, monthly %, streaks) is **derived at query time**, so it is deliberately
  **not** in the contract.
- `cells` carry `status` (not a raw bool) so `empty` is distinct from `missed`, and a
  per-cell `confidence` so the review UI can surface low-confidence CV classifications.
- `kind: eliminate` means a "green" cell = successfully avoided (§6) — a display concern,
  but it lives on the habit so the frontend needn't hardcode habit semantics.
- `flags` is how the red-line cross-check and other QA reach the review screen (§2, §9).
  Computing the flags is later specs' job; the contract only carries them.

## Location (CLAUDE.md §5/§11)
- Python: `services/pipeline/pipeline/contract.py` — in the **pure** module, no framework
  imports. `CONTRACT_VERSION` constant lives here.
- TypeScript: `apps/desktop/src/contract.ts` — hand-written 1:1 mirror (field names, enum
  string values, and `CONTRACT_VERSION` identical).

## Validation (enforced in Pydantic — this is a trust boundary)
- Ranges: `month 1..12`, every `day 1..31`, every `confidence 0.0..1.0`. Enum membership for
  `kind`/`status`. `habit`/`name`/`text` non-empty (after strip).
- Referential integrity: every `cells[].habit` matches some `habits[].name` (a model-level
  validator). Reject cells referencing an unknown habit.
- Uniqueness: no duplicate `(day, habit)` in `cells`; no duplicate `day` in `sleep`, in
  `moments`, or in `habits.name`. (Mirrors the DB uniqueness of spec 003.)
- `contract_version` must equal `CONTRACT_VERSION` on load; a mismatch raises (so an old
  archived draft can't be silently misread).

## Acceptance criteria (testable)
1. `contract.py` defines `Extraction` and its member models + the two enums + `CONTRACT_VERSION`,
   and imports nothing from `fastapi`/`tauri`/`uvicorn`/`http` (§5 boundary; grep clean).
2. A representative valid month sample (`~2 habits × a few days`, one sleep reading, one
   moment, one flag) validates via `Extraction.model_validate(...)`, and
   `model_dump()` round-trips back to an equal dict (JSON stability).
3. Validation **rejects** each of: `month=13`; a `day=0` and a `day=32`; `confidence=1.5`;
   an empty habit name; a `cell` whose `habit` is not in `habits`; a duplicate `(day, habit)`
   cell; a `contract_version` that differs from `CONTRACT_VERSION`.
4. `contract.ts` mirrors every field name and enum string value 1:1, and exports the same
   `CONTRACT_VERSION` integer. `tsc -b` (frontend build) passes with the new file.
5. One runnable check ships: a `tests/test_contract.py` (or `__main__` self-check) covering
   AC 2 and AC 3, passing under `uv run pytest`.

## Edge cases
- **Empty sub-lists:** `sleep`, `moments`, `flags` may be `[]` (Phase 1 enters sleep/notes
  manually). `cells` and `habits` empty is allowed by the type but expected only for a blank
  template; no special-casing.
- **Unknown language:** `lang` is best-effort (`en`/`fr`/`dar` or `null`) — a free string, not
  an enum, so an unclassified line isn't a hard failure.
- **Day beyond month length** (e.g. day 31 in April): out of scope here — the contract only
  bounds `1..31`; calendar validity is a commit-time (spec 003) concern.

## Out of scope (deferred)
- `extract()` and `commit()` implementations, the HTTP route returning an `Extraction`, and
  any CV/OCR/LLM — later specs. This is types only.
- **DB persistence / schema** (spec 003). The contract intentionally omits derived values and
  surrogate ids; it is the pre-persistence draft, not the storage model.
- **Drawn red-line total** as an extracted value: the cross-check *result* rides in `flags`
  now, but reading the drawn total off the chart is Phase 2 — added then as a deliberate,
  versioned contract change (`CONTRACT_VERSION` bump), per §10.
- **TS codegen tooling** (e.g. datamodel-codegen): the mirror is hand-written for now.
  `# ponytail: hand-mirror the ~5 models; add codegen only if the contract starts churning.`

## Verification runbook
1. `uv run pytest tests/test_contract.py` → green (AC 2, 3, 5).
2. `grep -rE "fastapi|tauri|uvicorn|http" services/pipeline/pipeline/contract.py` → no hits (AC 1).
3. In `apps/desktop`: `npm run build` (`tsc -b && vite build`) passes with `contract.ts` (AC 4).
4. Eyeball `contract.py` vs `contract.ts`: field names + enum values + `CONTRACT_VERSION` match.
