# 011 — Month-over-month trends (deterministic)

Status: spec

## Intent
Phase 3, first slice: see habits **across months**, not just within one. Completion %, mean
sleep, and per-habit completion charted over every committed month. Deterministic only — no LLM,
no new stored data. The grid stays the single source of truth (§6); every number is derived at
read time by reusing the existing `monthStats`.

## Inputs / Outputs
- Source: the months already returned by `GET /months` + `GET /months/{y}/{m}` (spec 007). No new
  endpoint, no SQL — the Trends view fetches each committed month's payload and reduces it with
  the existing analytics. (A handful of months per user; fetching each is trivially cheap.
  `ponytail:` per-month fetch, add a SQL `/trends` aggregate only if month count ever gets large.)
- New `model/analytics.ts` helper `monthSummary(data) -> { year, month, completion, meanSleep|null,
  bestStreak, perHabit: {name, pct|null}[], activeDays }`, built from `buildMatrix` + `monthStats`
  (reuse, don't re-derive). A `trendSeries(list) -> summary[]` sorted ascending by (year, month).
- New `view/Trends.tsx`: a third top-nav view. Renders, in chronological order:
  1. **Completion line** — monthly % across months.
  2. **Mean sleep line** — only for months that logged sleep (gaps allowed).
  3. **Per-habit table** — habit rows × month columns, each cell the month's completion % for that
     habit, tinted by value (green scale); habits that appear in some months but not others show
     blank where absent.

## Acceptance criteria
1. With ≥2 committed months → the two lines and the habit table render in chronological order,
   numbers matching each month's own dashboard panel exactly (same `monthStats`).
2. With exactly 1 month → show that single point/column plus a muted note that trends need ≥2
   months. Never crash on N=1.
3. With 0 months → the same empty-state as the dashboard ("import one from the Import tab").
4. A habit present in only some months → blank cells where it is absent, not 0%.
5. Months with no sleep → omitted from the sleep line (not drawn as 0).

## Edge cases
- Habit renamed between months reads as two different habits (name is the key) — acceptable for
  now; noted, not solved here.
- Single-month sleep → sleep line shows one point (or a note if none).

## Out of scope
- LLM insights/correlations (later Phase 3 slice), sentiment over moments, the red-line total
  cross-check, any backend/DB/contract change, habit-identity reconciliation across renames.
