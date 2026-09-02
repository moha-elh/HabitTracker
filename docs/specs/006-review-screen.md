# Spec 006 — Review & correct screen (grid-first)

Status: **implemented (build green)** · Phase: 1 · Depends on: 004, 005 · Blocks: dashboard

> Note (2026-09-02): built and type-checks under `tsc` strict + vite. Runtime ACs 1–4 are
> verified in `npm run tauri dev` (import a real grid crop → edit → commit).

## Intent
The Phase-1 payoff and the human-in-the-loop gate (CLAUDE.md §10): import a photo, see the
draft grid over the rectified image, **correct it by hand**, and commit. Nothing is ever saved
without this pass. Grid-first scope: cells + habit names + commit; sleep and moments come later.

## Flow
1. **Import view** — pick a photo, set year + month, click *Extract*. POST `/extract`
   (spec 005). Show a spinner (the free-tier label read takes ~tens of seconds).
2. **Review view** — render the rectified grid image + an editable `habits × 31` grid:
   - each cell colored by status (done = green, missed = pink, empty = paper) using the 2a
     tokens; **click cycles** done → missed → empty.
   - **low-confidence cells** (`confidence < 0.6`) get an orange ring so the eye goes there.
   - habit **row labels are editable text inputs** (fix LLM misreads / blanks).
   - *Commit* builds an `Extraction` from the current grid and POSTs `/commit`.
3. **Done view** — show the `MonthRecord` counts; offer "import another".

## Inputs / Outputs
- Uses the sidecar over loopback (port from the existing `sidecar_port` Tauri command).
- Types come from `src/contract.ts` (spec 002) — the frontend's half of the contract.
- Draft cells carry `confidence`; the UI reconstructs a full `rows × 31` matrix (missing cells
  = `empty`) and, on commit, emits only non-empty cells (matches spec 003 mapping).

## Acceptance criteria
1. Selecting a photo + year/month and clicking Extract calls `/extract` and renders the
   returned habit names, the rectified image, and a grid whose cells match the draft statuses.
2. Clicking a cell cycles done → missed → empty and updates its color; editing a habit name
   updates that row's label.
3. Low-confidence cells are visually ringed.
4. Commit posts a valid `Extraction` (unique, non-blank habit names; only non-empty cells) and,
   on success, shows the persisted counts; a server `422` is surfaced legibly, not swallowed.
5. `tsc -b && vite build` passes (TypeScript strict).

## Edge cases
- **Blank / duplicate habit name:** guarded client-side before commit (trim; auto-suffix
  duplicates) so the contract's uniqueness/non-blank rules don't 422 mid-review.
- **GridNotFound (422 from /extract):** show "couldn't locate the grid — crop closer" and stay
  on the import view.
- **Slow / failed extract:** spinner + a clear error with a retry; no silent hang.

## Out of scope (deferred)
- **Sleep + moments editing** — a later pass (grid-first per the chosen scope).
- **The dashboard** (heatmap, %, streaks, cross-check) — next spec.
- **Panning/zooming** the photo, per-cell confidence readouts, undo/redo.
- **Cropping UI** — for now feed a grid-cropped photo; a crop tool is a later nicety.
  `# ponytail: no in-app crop yet; localization is reliable on a grid-cropped photo.`

## Verification runbook
1. `npm run build` (tsc strict + vite) passes.
2. `npm run tauri dev` → Import a `docs/samplePhoto/` grid crop, year 2026 month 8 → review
   grid appears with ~13 rows → toggle a few cells, fix a habit name → Commit → counts shown.
3. Re-commit the same month → idempotent (spec 003); dashboard (later) reflects one month.
