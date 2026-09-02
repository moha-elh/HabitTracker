# 009 — Manual sleep entry

Status: implemented (build green; awaiting visual check in `tauri dev`)

## Intent
Sleep (blue line) is the only independent continuous metric (CLAUDE.md §2) — it can't be
computed from the grid. OCR of the written number is deferred (Phase 2); for now it's entered by
hand in the review screen, committed to `metrics`, and drawn on the dashboard's totals/sleep
chart (which already renders it when data exists). This closes the last Phase-1 gap.

## Inputs / Outputs
- Frontend `Draft` gains `sleep: (number | null)[]` — one slot per day (index = day-1); `null` =
  no reading. Populated from `ex.sleep` (empty today) and editable in review.
- `toExtraction` emits `SleepReading[]` for the non-null days (contract already has `sleep`).
- No API/DB/contract change: `commit_extraction` already persists `ex.sleep` to `metrics`, and
  `GET /months/{y}/{m}` already returns `sleep`, which `MonthPanel` already charts.

## Acceptance criteria
1. Review shows a compact per-day hours editor; entering values, then committing, persists them.
2. The dashboard's "Daily totals & sleep" chart draws the blue sleep line, and the Mean-sleep
   card + selected-day Sleep tile fill in.
3. Days left blank stay `null` (no `metrics` row); re-import replaces prior sleep (idempotent).
4. Out-of-range / non-numeric input is ignored (kept `null`); no `/commit` 422.

## Edge cases
- Hours accept a decimal (e.g. 6.5); clamp to a sane 0–24, blank clears to `null`.
- A month with no sleep entered behaves exactly as before (no sleep line, "—" stats).

## Out of scope
- Sleep-number OCR from the photo (Phase 2), the drawn red-line total cross-check.
