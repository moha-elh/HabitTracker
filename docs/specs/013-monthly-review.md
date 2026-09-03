# 013 — Monthly insights page + AI review

Status: spec

## Intent
Dashboard changes after spec 012:
1. **A "Monthly review" launcher card** (right column, under the day rail) opens a **full-screen
   insights page**: headline stats, per-habit breakdown (completion + longest streak), a rhythm
   panel and a sleep panel (with a computed sleep-vs-habits correlation), and a **data-grounded AI
   review + advice**. The AI is fed the paired sleep/productivity series, their Pearson correlation,
   and weekday averages, and is prompted to cite specific habits/days/numbers (no generic advice);
   the review is cached in the DB (persistent) and only regenerated on Redo. The card grows to fill
   its column so its bottom lines up with the chart card on the left.
2. **A silly confetti card** sits to the left of the "Daily totals & sleep" chart (in the aligned
   left zone that keeps the chart's day columns under the grid's): a running click count that
   rains paper confetti down the screen on each click (Web Animations API, no library, self-cleaning).
   Source photos are still reachable from the "View source images" button in the dashboard header.

## Inputs / Outputs
- **DB (migration 3)**: `months.confetti INTEGER DEFAULT 0` (persistent click counter) and
  `months.ai_review TEXT` (cached LLM review markdown). Both travel on the `load_month` payload.
- **API**:
  - `GET /months/{y}/{m}/review` -> `{review, cached}`. Returns the DB-cached review with no model
    call when present; otherwise generates, caches, returns. `?refresh=true` forces a regenerate
    (the Redo button). 404 uncommitted, 503 if no key AND nothing cached.
  - `GET/PUT /months/{y}/{m}/confetti` -> `{count}`. PUT sets the absolute count (frontend debounces
    a click burst into one write). 404 if uncommitted.
- **Dashboard card**: shows the cached review's opener sentence (persistent, no call on load) and a
  "View analytics" button; the confetti card loads its count from the payload and persists clicks.
- **`readers.review_from_env()`** -> `OpenAICompatReviewer | None` (None when no key). Reuses the
  same OpenAI-compatible chat endpoint as the label/sleep/moments readers (`_text_call`, text-only,
  no image). Model override: `REVIEW_MODEL` (falls back to `LABEL_READER_MODEL`).
- **`main._month_summary(data)`**: compact, number-rich text summary of a committed month
  (completion overall + per habit, sleep mean/min/max, strongest day, sample moments) built from
  `store.load_month`. Only this summary is sent to the LLM, never the raw photos.
- **Frontend**: `fetchMonthReview(y, m)` in `model/api.ts`; `MonthReview` card in `Dashboard.tsx`
  with idle -> loading -> done/error states and a tiny markdown-ish renderer (paragraphs, `- `
  bullets, `**bold**`). No markdown dependency added.

## Layout
Left column: grid card, then a flex row `[Compare-photo card (92px)] [gap 14] [chart card 1fr]`.
The compare card width plus the chart card's own padding (22) and slim y-axis (26) sum to the
grid's label gutter (22 + 132 + 10 = 164), so the chart stays day-aligned with the grid.
Right column: selected-day rail, then the Monthly review card.

## Acceptance criteria
1. "Review my month" opens the full-screen insights page for the selected month; Close returns to
   the dashboard. The page shows analytics computed from the grid (same monthStats as the panel)
   plus the AI review, which cites the month's real numbers and renders its bold/bullets. No key
   shows the 503 note; a network failure shows an error with Redo.
2. The confetti card's day-zone width keeps the chart's columns aligned under the grid's; clicking
   it increments the count and drops confetti that cleans itself up.
3. The Monthly review card's bottom aligns with the chart card's bottom.

## Out of scope
- Caching/persisting reviews (regenerated on demand), streaming the reply, any contract/DB change.
  `ponytail:` if reviews get slow or costly to redo, cache the last review per month in the DB.
