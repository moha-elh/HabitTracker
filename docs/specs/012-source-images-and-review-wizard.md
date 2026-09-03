# 012 — Source-image archive, review wizard, dashboard polish

Status: spec

## Intent
A batch of usability fixes requested after spec 011:
1. **Archive the source photos** so the dashboard can show them back (§10 "archive raw inputs",
   never wired up before: `months.photo_path` was unused).
2. **Review becomes a 3-step wizard** (grid → sleep → moments) instead of one long scroll.
3. **Import shows a thumbnail** of each picked page.
4. **Dashboard polish**: centered month selector + a "View source images" popup; a mean-sleep
   sparkline; best-day shown as the bold date with its habit count under it; a fire emoji on a
   live streak.
5. **No em dashes** in any user-facing text (project-wide style rule, going forward too).
6. **Reference photo auto-orients** to portrait (habit names on top, grid below) regardless of
   upload angle, with a manual Rotate button in review for the remaining 180° flip.

## Inputs / Outputs
- **DB (migration 2)**: add `months.grid_image TEXT`, `months.moments_image TEXT`, storing each
  page as a self-describing **data-URL** (single user, ~12 months/yr).
  `ponytail:` data-URL in sqlite; move to on-disk files only if the DB ever bloats.
- **`store.commit_extraction(..., grid_image=None, moments_image=None)`**: upsert uses
  `COALESCE(excluded.x, months.x)` so a re-commit without images preserves the stored ones.
- **`store.load_month_images(y, m) -> {grid, moments} | None`**.
- **API**: `/commit` body becomes `CommitRequest {extraction, grid_image?, moments_image?}`;
  new `GET /months/{y}/{m}/images` (404 if uncommitted). Kept off the main month payload so the
  dashboard only fetches images when the popup opens.
- **Frontend**: `Draft` gains `momentsImage: string|null`; App reads the moments File to a data
  URL and sends both images on commit; `commitExtraction(ex, {grid_image, moments_image})` and
  `fetchMonthImages(y, m)` in `model/api.ts`.

## Acceptance criteria
1. Commit with a grid image → `GET …/images` returns it; a later re-commit without images keeps
   it (COALESCE). Uncommitted month → 404. (Backend test covers this.)
2. Review shows one step at a time; Next/Back move between grid → sleep → moments; Commit only on
   the last step. The grid step shows the oriented name-inclusive crop (Rotate/Flip); the sleep
   step spans the page with the full original photo (which holds the blue sleep chart the crop
   drops) on the right; the moments step is full-width with no reference image (verified by hand).
3. Import shows an ~76px thumbnail for each picked page, with Remove; the blob URL is revoked on
   change (no leak).
4. Dashboard: selector centered with a "View source images" button opening a popup of the two
   stored photos (graceful message for months committed before this spec / with no photo). Mean
   sleep card shows a sparkline; best-day card shows the bold date then "N of M habits that day";
   longest-streak card shows 🔥 when the streak > 0.
5. No em dash appears in any rendered string.
6. A landscape (names-on-left) capture shows portrait with names on top by default; a sideways
   or upside-down upload is fixable to the same layout with the Rotate button. The orientation
   the user leaves is what gets archived as `grid_image` on commit.

## Edge cases
- Month committed before migration 2 → images are NULL → popup shows a "no stored images" note,
  never crashes.
- Empty-metric placeholders use "·" (middot), not an em dash.

## Out of scope
- On-disk image storage, thumbnails in the DB, re-processing an archived photo, any contract or
  analytics change. The grid stays the single source of truth (§6); images are reference only.
