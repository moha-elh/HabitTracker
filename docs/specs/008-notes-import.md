# 008 — Two-image import: habit grid + memorable moments

Status: implemented (build + tests green; awaiting visual/LLM check in `tauri dev`)

## Intent
An import is one month's **spread** = two pages: the **habit grid** (right page, already handled)
and the **memorable moments** (left page, one handwritten line per day, EN/FR/Darija). Accept
both images at import, read the moments via the provider-agnostic vision LLM, and carry them
through review (editable — human-in-the-loop) into the committed month so the dashboard shows
each day's line. The moments image is **optional**; grid-only import must still work.

## Inputs / Outputs
- Reader interface (mirrors `LabelReader`, spec 004): `MomentsReader.read(image_png) -> list[{day, text}]`.
  - `NullMomentsReader` (no key → `[]`), `StubMomentsReader` (tests). Network impl
    `OpenAICompatMomentsReader` in `readers.py` (outside the pure package), `moments_from_env()`.
- `POST /extract` gains an optional `moments_image` file. When present, the moments reader runs and
  the returned `extraction.moments` is populated (day clamped to the month length, deduped by day,
  blank text dropped). No `moments_image` → `moments: []` (unchanged behaviour).
- Frontend `Draft` gains `moments: {day, text}[]`; committed via the existing contract `moments`.

## Acceptance criteria
1. Import with both images → review shows the extracted moments as editable `day + text` rows;
   commit persists them; the dashboard's selected-day rail shows that day's line.
2. Import with only the grid image → works exactly as before (`moments: []`).
3. Moments the reader returns for a day beyond the month length, or duplicate days, are dropped/
   deduped so `/commit` never 422s on them.
4. No API key → moments come back empty; the user can still add moments by hand in review.
5. Contract unchanged (moments already in the contract since spec 002); no version bump.

## Edge cases
- Reader returns malformed JSON → treated as no moments (never crash the grid extract).
- Blank text lines are skipped (contract forbids blank moment text).
- Editing a moment's day to collide with another is resolved at commit (dedupe keeps the first).

## Out of scope
- Sleep OCR (still manual/later), notes language tagging (`lang` left null), left-page layout CV.
- Any change to the grid pipeline.
