# Handoff: Habit Chronicle — month dashboard (direction 2a)

## Overview
Habit Chronicle digitizes a hand-kept paper habit journal. The user photographs a
monthly spread; the app extracts the habit grid, the per-day totals drawn as a red
line, sleep hours, and the one-line "memorable moment" written for each day. This
handoff covers the **month dashboard** — the screen the user lands on after a month
has been imported and reviewed.

Direction **2a** was selected: warm paper surfaces, dense widget grid, Grand Hotel
for the month/day headings and Lato for everything else.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes that
show intended look and behavior, not production code to copy. Recreate them in the
target codebase using its existing environment (React, Vue, SwiftUI, native…) and its
established patterns and libraries. If no environment exists yet, pick the framework
that fits the project and implement there. `tokens.css` is the exception: it is meant
to be adopted directly, or translated 1:1 into the codebase's own token format.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii and interaction states below are final.
Recreate pixel-accurately. The data shown in the prototype is seeded fake data.

## Screens / Views

### Month dashboard
**Purpose:** read one imported month at a glance, inspect any single day, and resolve
the days where the extracted grid disagrees with the hand-drawn total line.

**Layout** — page padding `26px 28px 30px` on `--hc-bg`, max content width 1180px.
Vertical stack, `14px` between every block:

1. **Header row** — flex, `align-items:flex-end`, space-between.
2. **Source-photo panel** — collapsed by default; full width when open.
3. **Stat row** — `grid-template-columns: repeat(4, 1fr)`, gap 14px.
4. **Body** — `grid-template-columns: 1fr 336px`, gap 14px.
   - Left column (stack, gap 14px): habit grid card, then totals-vs-sleep chart card.
   - Right rail (stack, gap 14px): selected-day detail card (flex:1), then cross-check card.

#### Components

**Header — title block (left)**
- Eyebrow "HABIT CHRONICLE": 11px / 700 / uppercase / tracking .14em / `--hc-text-label`… rendered in `#a79c8e`; 7px below.
- Month title "June 2026": `--hc-font-display` 46px, weight 400, tracking 0, line-height 1, `--hc-text`.
- Meta "Imported 1 Jul · 13 habits · 30 days": 13px / `--hc-text-muted`, 8px above gap.

**Header — controls (right)**, flex, gap 10px, all `border-radius:10px`, padding `9px 14px`, 12.5px / 700:
- *Flag pill* (non-interactive status): bg `--hc-flag-bg`, 1px border `--hc-flag-border`, text `--hc-flag-text`; 7px circular `--hc-flag` dot, 8px gap. Copy: "2 days flagged by cross-check".
- *View source photo* (toggle): white bg, 1px `--hc-border-strong`, text `#5f584d`; 15×12px rounded rectangle glyph as an icon. Hover: border → `--hc-text`. Toggles the source-photo panel.
- *Import a spread* (primary): bg `--hc-surface-ink`, white text, padding `9px 16px`, no border.

**Source-photo panel** (visible only when toggled on)
White card, 1px `--hc-border-strong`, radius 16px, padding 16px, flex row gap 16px.
Two flexible 180px-tall image slots (radius 10px) side by side — left page and habit
grid crops of the archived photo — plus a fixed 180px meta column: "Source photo"
(12.5px/700), filename · megapixels · archive date (11.5px `--hc-text-muted`,
line-height 1.5), and a "Hide" action (11.5px/700 `--hc-flag-text`).
*In production these are the real uploaded photo crops.*

**Stat widget ×4** — white, 1px `--hc-border`, radius 16px, padding `18px 20px`.
- Label: 11.5px / 700 / uppercase / tracking .06em / `--hc-text-label`.
- Value: 32px / 900 / tracking -.02em, 10px below label; optional trailing unit or
  delta at 12.5–13px (delta in `--hc-done`).
- Footer varies: a 6px progress bar (track `--hc-rule`, fill `--hc-done`, radius 3px)
  plus caption, or two caption lines (12.5px/700 `#5f584d` then 11.5px `#a79c8e`).
- Content: Completion 62.3% (+32.1, "243 of 390 cells green") · Longest streak 18 days
  ("Morning pages", "4 Jun → 21 Jun") · Mean sleep 6.9 h/night ("σ 1.2 · shortest 4.5h
  on 9 Jun") · Best day 11 of 13 habits ("Saturday 20 June", "Worst: 2 Jun — 1 habit").

**Habit grid card** — white, 1px `--hc-border`, radius 18px, padding `20px 22px 22px`.
- Header: title "The grid" 16px/700 tracking -.01em; sub "Click a day column to read
  that day" 11.5px `#a79c8e`. Right: legend, 11.5px `--hc-text-muted`, three items
  gap 14px, each with an 11px swatch (radius 3px) — done `--hc-done`, missed
  `--hc-missed`, flagged day `--hc-flag`.
- Body: flex gap 10px. Fixed 132px label column (padding-top 20px to clear the day-number
  row; rows 19px tall, gap 5px; habit name 11.5px/500 `--hc-text-body` truncated with
  ellipsis, right-aligned percentage 10px `#b3a99b` tabular-nums).
- Matrix: 13 rows × 30 columns, `grid-template-columns: repeat(30, 1fr)`, gap 3px,
  row height 19px, cell radius 4px. Cell fill: kept `--hc-done`, missed `--hc-missed`;
  in the selected column, `--hc-done-deep` / `--hc-missed-deep` plus
  `box-shadow: 0 0 0 1.5px var(--hc-flag)`.
- Day-number header row above the matrix: 15px tall, 8.5px tabular-nums, radius 4px.
  Default `--hc-text-faint` on transparent; flagged day `--hc-flag-text` on
  `--hc-flag-bg`; selected day white on `--hc-surface-ink`, weight 700.
- Every cell and every day number is a click target that selects that day.

**Totals & sleep chart card** — white, 1px `--hc-border`, radius 18px, padding `20px 22px 18px`.
- Header: "Daily totals & sleep" 16px/700; sub "Habits completed per day, computed from
  the grid, against hours slept". Legend right: 14×3px bars — habits/day `--hc-done`,
  sleep `--hc-sleep` — and a 9px `--hc-flag` dot for "line mismatch".
- Plot: 170px tall SVG, `viewBox="0 0 600 170"`, `preserveAspectRatio="none"`; all
  strokes use `vector-effect: non-scaling-stroke`. Fixed 22px y-axis gutter on the left
  labelled 13 / 9 / 4 / 0 (9.5px `--hc-text-faint`).
- Layers, back to front: 4 horizontal gridlines (`--hc-rule`; baseline `#e5ddd1`) →
  dashed vertical selection rule (`#e8c8a8`, `3 3`) → habits area fill (`--hc-done` at
  13% opacity) → habits line (`--hc-done`, 2.2px, round joins) → sleep line
  (`--hc-sleep`, 1.8px, dash `5 4`) → r=4 `--hc-flag` dots on mismatch days → selected-day
  marker (r=4.5 white fill, 2.5px `--hc-done` stroke).
- Scales: habits 0–13 top-to-bottom over y 169→1; sleep 3.5–10h over the same range.
- X tick row below: 30 columns, label every 5th day, 8.5px `--hc-text-faint`.

**Selected-day rail** — white, 1px `--hc-border`, radius 18px, padding 20px, flex:1.
- Heading row: day name `--hc-font-display` 26px (e.g. "Saturday 20 June"); right
  "day 20 of 30" 11.5px `#a79c8e`.
- Two inset tiles, flex gap 8px, bg `--hc-surface-sunk`, radius 12px, padding `12px 14px`:
  label 10.5px/700 uppercase tracking .08em `#a79c8e`; value 22px/900 with a 12px/600
  muted unit ("/ 13", "h").
- "MEMORABLE MOMENT" label, then the moment line at 15px / line-height 1.5 /
  `text-wrap: pretty`; caption below: "read from the left page · confirmed at review"
  (11px `--hc-text-faint`). Days with no moment show
  "No line written on the left page for this day."
- Divider (`1px --hc-rule`, 18px above / 14px below), then "KEPT THAT DAY": two wrapping
  chip rows, gap 6px, chips 11.5px, padding `5px 11px`, radius 20px — kept
  `--hc-done-tint`/`--hc-done-text`, missed `--hc-missed-tint`/`--hc-missed-text`.

**Cross-check card** — bg `--hc-flag-bg`, 1px `--hc-flag-border`, radius 18px, padding
`18px 20px`. Title "Cross-check flags" 13px/700 `--hc-flag-text`. One white card per flag
(radius 12px, padding `12px 14px`, 8px apart): day 12.5px/700 `--hc-text`, explanation
11.5px `--hc-text-muted`. Each card selects its day on click. Footer link
"Re-open review →" 11.5px/700 `--hc-flag-text`.

## Interactions & Behavior
- **Select a day** — clicking any grid cell, any day number, or any cross-check card sets
  the selected day. That single value drives: the cell tint + ring in the grid column, the
  day-number pill, the dashed rule and marker in the chart, and the whole rail. Default
  selection on load is the best day of the month.
- **Source photo** — the header button toggles the panel open/closed; "Hide" closes it.
- **Hover** — "View source photo" border darkens to `--hc-text`. Clickable cells,
  day numbers and flag cards use `cursor:pointer`; a subtle brightness or 1px lift on
  hover is acceptable, nothing was specified.
- **Transitions** — none in the prototype. If added, keep them ≤150ms ease-out on
  color/opacity only; the grid must never animate position.
- **Loading** — a month renders only after import + review, so the dashboard has no
  partial state. Skeletons should mirror the widget rectangles.
- **Empty** — a day with no extracted moment shows the fallback sentence above; a month
  with no flags should hide the cross-check card entirely rather than show a zero state.
- **Responsive** — designed at 1180px. Below ~1000px, drop the rail beneath the left
  column and the stat row to 2×2. The 30-column grid should scroll horizontally rather
  than shrink cells below ~10px.

## State Management
- `selectedDay: number` (1–30) — the only cross-widget state.
- `photoOpen: boolean`.
- Month payload (fetched): `habits: { name, cells: boolean[30] }[]`,
  `sleepHours: number[30]`, `moments: Record<day, string>`,
  `flags: { day, gridTotal, lineTotal, note }[]`, `sourcePhoto: { url, crops, filename, capturedAt }`.
- Daily totals, per-habit percentages, streaks and the month summary stats are **derived**
  from `habits`, never stored — the prototype computes them on every render.

## Design Tokens
See `tokens.css` — the full palette, type scale, spacing, radii and the one elevation
value, all as CSS custom properties with inline notes on where each is used. Summary:
- Neutrals are warm (paper), never gray: `#faf7f2` `#ffffff` `#f7f4ee` `#ece5da` `#241e18`.
- Three data hues only: green `#6fa86a` (kept), blue `#4a86c4` (sleep), orange `#e8843c`
  (cross-check / selection). Missed is a desaturated clay tint, not red.
- Spacing is a 4px scale; 14px is the universal gutter between widgets.
- Radii escalate with element size: 4 cell → 10 control → 12 tile → 16 card → 18 panel → 20 pill.
- No shadows. Structure comes from 1px warm borders.

## Assets
None shipped. The two image slots in the source-photo panel are placeholders for the
user's own uploaded spread photos. Fonts are Google Fonts: **Grand Hotel** (400) and
**Lato** (400/700/900) — the `@import` is at the top of `tokens.css`.

## Files
- `tokens.css` — design tokens, ready to adopt.
- `MonthPanel.dc.html` — the dashboard itself, and the single approved design (**direction
  2a: Grand Hotel + Lato**). Markup is in the template section, all derived data and
  interaction logic in the `class Component` block at the bottom. Every type value is
  hardcoded to 2a — there are no font/direction toggles. This is the only design to build
  from; do not reintroduce alternates.
