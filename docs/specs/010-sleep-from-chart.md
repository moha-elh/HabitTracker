# 010 — Sleep from the chart image (vision read)

Status: done (build + tests green). Accuracy tuned: sleep read at 1600px (vs 1024 for
labels/moments) and prompted to round to the nearest half-hour and omit unclear days rather
than guess — remaining error is corrected by hand in the review Sleep grid (by design).

## Intent
Read the hand-drawn **blue "sleep" line** automatically instead of typing it (the deferred half
of spec 009). The line chart sits beside the grid on the **same** right-page photo, so it is read
from the grid image itself — **no separate upload**. The vision LLM estimates each day's hours;
the review Sleep grid (spec 009) shows them for correction — human-in-the-loop, since a
hand-drawn line read by an LLM is approximate.

## Inputs / Outputs
- Reader interface (mirrors `MomentsReader`, spec 008): `SleepReader.read(image_png) -> list[{day, hours}]`.
  - `NullSleepReader` (no key → `[]`), `StubSleepReader` (tests). Network impl
    `OpenAICompatSleepReader` in `readers.py`, `sleep_from_env()`.
- `POST /extract` runs the sleep reader over the **grid `image`** on every import and populates
  `extraction.sleep` (hours clamped 0–24, day deduped + clamped to month length). Response gains
  `sleep_status` ("read N" / "nothing read" / "error: …"), same pattern as `moments_status`.
  (This adds a third vision call per import; a month whose photo has no chart just reads nothing.)
- No contract/DB change: `sleep` is already in the contract and `metrics` table; the review Sleep
  editor and the dashboard chart already consume it.

## Acceptance criteria
1. Import with a sleep chart image → review Sleep grid pre-fills with the read hours; committing
   persists them; the dashboard sleep line/stats fill in.
2. No sleep image → `sleep: []` (manual entry still works, unchanged).
3. Malformed/empty LLM reply → no sleep, never a 500 (caught + reported in `sleep_status`).
4. The reader targets the BLUE sleep line, not the red "total of habits" line.

## Edge cases
- Out-of-range hours / duplicate or out-of-month days are dropped so `/commit` never 422s.
- No API key → empty; user types sleep by hand (spec 009).

## Out of scope
- Red-line total cross-check (still needs the total line), CV line-tracing (LLM read for now).
