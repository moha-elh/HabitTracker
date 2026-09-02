# 007 — Dashboard

Status: implemented (build + tests green; awaiting visual check in `tauri dev`)

## Intent
Visualize a committed month read back from SQLite: a heatmap that recreates the paper grid,
the monthly completion %, per-habit completion % and current streak, and the daily totals
(green cells per day). Read-only. Every derived number is **computed at read/render time**,
never stored (CLAUDE.md §6) — the grid stays the single source of truth.

## Inputs / Outputs
New read endpoints on the sidecar (the frontend never touches SQLite directly — §3):

- `GET /months` → `[{year, month, imported_at, entries}]`, newest first. Lists committed months
  for the selector.
- `GET /months/{year}/{month}` → month payload, or **404** if that month isn't committed:
  ```
  {
    year, month, days,                     # days = calendar length of the month
    habits:  [{name, kind, sort_order}],   # in sort_order (the reviewed grid order)
    entries: [{day, habit, done}],         # only marked cells; done: 1|0. Missing (day,habit) = empty
    sleep:   [{day, hours}],
    moments: [{day, weekday, text}]
  }
  ```

Derived values (frontend, from `entries`):
- **daily total**(day) = count of `done` across habits that day.
- **monthly %** = done ÷ (done + missed) over all tracked (non-empty) cells.
- **per-habit %** = that habit's done ÷ (done + missed).
- **per-habit current streak** = consecutive `done` days counting back from the habit's
  highest day that has an entry.

## Acceptance criteria
1. Commit a month, open the dashboard → its heatmap shows the same green/red/empty cells as
   the review grid (green = done, red = missed, blank = empty/untracked).
2. Monthly % and daily totals render and match the entries.
3. Each habit row shows its completion % and current streak.
4. The month selector lists every committed month; switching months re-fetches and re-renders.
5. Opening a not-committed month returns 404 and the UI shows an empty/hint state (no crash).
6. Schema is unchanged — no derived value is persisted (grep: migrations untouched).

## Edge cases
- Month with zero entries → empty heatmap, 0 totals, no divide-by-zero (guard `done+missed==0`).
- A habit with all-empty cells that month won't appear (it has no `entries` rows) — acceptable;
  such a habit carries no signal. `ponytail:` month↔habit link is only via `entries`.
- Missing `sleep` / `moments` → those panels are omitted, not shown empty.
- Re-imported month reflects the latest commit (idempotent replace, spec 003).

## Out of scope
- **Red-line cross-check** (compare computed daily totals against the *drawn* total line) — the
  drawn line isn't extracted yet; deferred with the total-line reader.
- Sleep/notes charts beyond listing values if present; cross-month trends, correlations,
  insights (Phase 3).
