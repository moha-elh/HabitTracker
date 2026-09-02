# Habit Chronicle — Project Context

> Working name: **Habit Chronicle** (repo slug `habit-chronicle`). Rename freely — it's referenced only in paths below.

This document is the single source of truth for Claude Code working on this project. Read it fully before writing any code. When something here conflicts with an ad-hoc chat instruction, ask before diverging.

> **Revision (2026-09-02):** the analog side stays **hand-drawn, with no printed template and
> no fiducial markers** (decision by Moha; sample spreads in `docs/samplePhoto/`). The grid is
> located from its own **saturated green/red color block**, not from fiducials. The **habit
> list changes month to month and is read from the photo each import** (CV counts the rows; the
> vision-LLM reads only the handwritten label text). This supersedes §7 (paper template) and
> the fiducial parts of §4/§9 below, which are kept for context but marked. Reliability rests on
> the review screen (§10), since Moha corrects the draft by hand.

---

## 1. The Idea

I keep a physical, hand-drawn habit journal. Each month is a spread:

- **Left page — Memorable Moments:** one handwritten line per day (mixed English / French / Darija transliteration), e.g. *"Visited Hassan II Mosque in Casablanca."*
- **Right page — Habit grid:** ~13 named habits × 31 days. Each cell is **green** (done) or **red** (missed). Below it, a completion percentage (e.g. `30.26%`).
- **Two line charts:** *Sleep* (independent metric) and *Total of habits* (the count of green cells that day — a derived value, not an independent one).

I want to keep the analog ritual, and **at the end of each month photograph the spread and import it into a desktop app** that:

1. Extracts the data from the photo (grid, sleep, notes).
2. Stores it locally.
3. Visualizes everything on a dashboard.
4. Analyzes trends and surfaces insights over time.

This is a **personal, single-user, local-first** tool. Cadence is **once per month** (~12 imports/year) — optimize for reliability and build-clarity, not throughput.

---

## 2. Domain Model (read this carefully — it removes work)

Getting the domain right eliminates whole features:

- **Habits are binary per day.** The grid is the ground truth for everything.
- **"Total of habits" is DERIVED.** It's the column-sum of green cells per day. Do **not** extract it from the chart — compute it. Same for the completion `%` (green ÷ total cells).
- **The hand-drawn red line is therefore a free QA signal.** After computing daily totals from the grid, compare against the drawn red line. A mismatch flags a probable grid-extraction error on that day. Build this cross-check in.
- **Sleep (blue line) is the ONLY independent continuous metric.** It's the one thing that can't be computed from the grid, so it's the only chart that genuinely needs digitizing — entered manually in the review UI for now (OCR of the written number is a later upgrade; see §7).
- **Memorable moments** are one free-text line per day, multilingual.
- **A "month" is the unit of import.** Imports are idempotent: re-importing the same month updates rows keyed on `(year, month, day)`, never duplicates.

**Extraction targets collapse to three:** the grid (CV), sleep (OCR or manual), notes (vision LLM). Everything else is arithmetic.

---

## 3. Tech Stack

**Frontend / shell — desktop app**
- **Tauri v2** (Rust host) — native desktop app, small binary, secure.
- **React + TypeScript + Vite** for the UI.
- **Tailwind CSS** for styling (design system in `docs/design_system/`, direction 2a — see §12).
- Charts: **Recharts** (or visx); the habit heatmap as custom SVG/CSS.

**Pipeline / backend — Python sidecar**
- **Python 3.11+**, packaged with **PyInstaller** and shipped as a **Tauri sidecar binary**.
- Runs a local **FastAPI** (uvicorn) server on a loopback port; Tauri spawns it on launch and terminates it on exit. React talks to it over `http://127.0.0.1:<port>`.
- **OpenCV** (`opencv-python`) + **NumPy** for image processing (grid localization by color block, perspective warp, HSV cell classification — **no fiducials**; see the Revision note).
- **Vision LLM via the OpenAI-compatible chat API** for the vision steps — reading the handwritten **habit labels** (per month) and later the **notes**. Provider-agnostic on purpose: `base_url` + `model` + `api_key` come from **env** (never hardcode a model string), so any free provider works — Gemini (default), Groq, OpenRouter, or local Ollama — by env change alone. Called with `httpx` behind a swappable `LabelReader` interface; no key ⇒ blank labels typed in review (local-first). Current default model `gemini-flash-lite-latest` (Gemini's free tier, OpenAI-compat endpoint; heavier flash models time out on free quota). Images are downscaled before sending.
- API key from the OS secure store / `.env` (never in the repo or bundle — §10).
- **Pydantic** for the extraction JSON contract and API schemas.

**Data**
- **SQLite** — a single local file. **The Python sidecar owns all DB access** (single writer, no concurrency headaches). The frontend never touches the DB directly; it only calls the sidecar API.
- Migrations via **Alembic** (or a simple versioned-SQL runner) — yes, even for SQLite.

**Why this shape:** the hard part (CV + LLM) is Python; the UI I'm fluent in is React. Tauri lets both coexist. Critically, the pipeline is written as a **shell-agnostic module** (see §5) so the Tauri/HTTP layer is a thin wrapper — the same code could run from a CLI unchanged.

---

## 4. Architecture

```
┌─────────────────────────────────────────────┐
│  Tauri desktop app                           │
│  ┌───────────────────────┐                   │
│  │ React + TS (Vite)     │  HTTP (loopback)  │
│  │  - Import screen      │◄─────────────────┐│
│  │  - Review & correct   │                  ││
│  │  - Dashboard          │                  ││
│  │  - Insights           │                  ││
│  └───────────────────────┘                  ││
│            ▲ spawns/manages sidecar          ││
│  ┌─────────┴─────────────────────────────┐  ││
│  │ Rust host (Tauri)                     │  ││
│  └─────────┬─────────────────────────────┘  ││
└────────────┼─────────────────────────────────┘│
             ▼                                   │
   ┌──────────────────────────────────────────┐ │
   │ Python sidecar (FastAPI)  ────────────────┼─┘
   │  api/          thin HTTP layer            │
   │  pipeline/     PURE module (see §5)       │
   │    ├ grid          (color-block warp +    │
   │    │                CV row count + HSV    │
   │    │                cell classifier)      │
   │    ├ labels        (vision LLM: habit     │
   │    │                names, per month)     │
   │    ├ sleep         (manual / OCR later)   │
   │    ├ notes         (vision LLM, Phase 2)  │
   │    └ contract.py   (pydantic schemas)     │
   │  db/           SQLite (single writer)     │
   └──────────────────────────────────────────┘
```

**Data flow (one import):**
1. User drops a photo → frontend POSTs the image to the sidecar.
2. `grid` (localize): mask the saturated green/red block → find its 4 corners → perspective-warp to a canonical rectangle (**no fiducials** — the colored block is the registration target).
3. `grid` (classify): rows = the number of habit labels read; columns = the grid's day count (defaults to the month length, user-adjustable — grids vary, e.g. a 30-column August). Slice the rectified block into `rows × cols`, sample each cell's dominant color → HSV threshold → `done | missed | empty` with a confidence. (CV aspect-ratio counting proved unreliable on hand-drawn grids — counts come from the labels + the user instead.)
4. `labels`: crop the habit-label strip → vision LLM reads the handwritten row labels → habit names in row order (the list changes monthly). Falls back to blank labels (typed in review) if disabled/offline.
5. `sleep`: entered in the review UI (OCR of the written number is a later upgrade).
6. `notes` (Phase 2): send the notes crop to the vision LLM → structured `{day, weekday, text}[]`.
7. Sidecar returns a **draft** extraction (JSON matching the contract). **Nothing is saved yet.**
8. **Review screen**: draft overlaid on the photo; user corrects errors (including any habit names the LLM misread); the red-line cross-check highlights suspect days.
9. On confirm → sidecar writes to SQLite (idempotent on `(year, month, day)`), and archives the raw photo + raw extraction JSON.
10. Dashboard + insights read from SQLite.

**Local-first & private:** the only network calls are the vision-LLM steps (habit labels now, notes in Phase 2). Keep them isolated behind an interface so they can later be swapped for a local model or disabled (labels typed in review, notes photo-only).

---

## 5. The Non-Negotiable Boundary

`pipeline/` is a **pure module** with a plain function interface and **no knowledge of HTTP, Tauri, or the UI**:

```python
extract(image_bytes, grid_config, label_reader) -> Extraction  # image -> structured draft
commit(extraction, db) -> MonthRecord                          # draft -> persisted rows
```
`grid_config` holds non-habit settings (days=31, orientation, thresholds); habits are read
from the image. `label_reader` is the injected, swappable vision-LLM interface (the only
egress) — stubbed in tests, disable-able for offline/local-first.

- `api/` is a thin FastAPI wrapper that calls these.
- This is what makes "start on Streamlit, move to Tauri" (or add a CLI) cost nothing later. **Never leak framework concerns into `pipeline/`.**
- The **extraction JSON contract** (`contract.py`, Pydantic) is the spine of the system. Define it once, version it, and mirror it to TypeScript types (hand-written or generated). Frontend and backend agree on this schema and nothing else.

---

## 6. Data Model (SQLite)

Small and stable:

```
habits(id, name, kind, sort_order, active)
   -- kind: 'build' | 'eliminate'  (an eliminate habit "green" = successfully avoided)

months(id, year, month, imported_at, photo_path, raw_extraction_path, notes_ocr_ok)

entries(id, month_id, day, habit_id, done)          -- the grid; one row per cell
   -- unique(month_id, day, habit_id)

metrics(id, month_id, day, sleep_hours)             -- independent metrics only
   -- unique(month_id, day)

moments(id, month_id, day, weekday, text, lang)     -- memorable moments
   -- unique(month_id, day)
```

Everything derived (daily totals, monthly %, streaks, correlations) is **computed at query time**, never stored — so the grid stays the single source of truth.

---

## 7. Analog side (unchanged — no template) ~~Paper Template~~

> **Superseded by the Revision note.** The original plan co-designed a printable form with
> fiducials; Moha keeps the **existing hand-drawn journal as-is**. The software adapts to the
> photo instead of the paper adapting to the software. Kept below as rationale for *why the
> pipeline is heuristic + review-first*, not as a deliverable.

Consequences of having **no** template/fiducials (drove spec 004):

- **No corner fiducials** → the grid is located from its own **saturated green/red block**
  (largest color blob → contour → 4 corners → perspective warp). Residual spine-curvature is
  accepted and fixed in review.
- **No fixed grid geometry** → cell coordinates are **derived per image** (rectified rectangle
  sliced by CV-counted rows × 31 days), not stored constants.
- **Habit labels are handwritten and change monthly** → read per import by the vision-LLM
  (§10 division of labor), with a manual fallback.
- **Sleep** is entered in the review UI for now (OCR of the written number is a later upgrade;
  the drawn Total line stays a QA signal for grid totals).
- The ritual stays exactly as it is — the software does the adapting.

---

## 8. Development Methodology — SDD-lite

**Verdict:** use spec-driven development, lightweight. The reason is that Claude Code implements far better against a written spec with acceptance criteria than from chat improvisation. Skip the heavyweight ceremony; keep the discipline.

**Workflow (repeat per feature):**
1. **Spec** — write `specs/NNN-slug.md` before non-trivial code. Each spec contains: *Intent*, *Inputs/Outputs (referencing the contract)*, *Acceptance criteria (testable)*, *Edge cases*, *Out of scope*.
2. **Plan** — Claude Code proposes an implementation plan against the spec; human reviews.
3. **Implement** — small, spec-linked commits.
4. **Verify** — check against the spec's acceptance criteria; for CV, against golden tests (§9).
5. **Close** — mark the spec done; update it if reality diverged (specs are living docs).

**Phase gates:** don't start a phase until the previous phase's specs are green. `specs/` is committed and is the project's memory. (If more structure is ever wanted, a tool like GitHub's spec-kit formalizes this same loop — but the folder-of-specs approach is enough here.)

---

## 9. Roadmap

### Phase 1 — MVP (the 20% that delivers 80%)
Grid → dashboard. Almost entirely deterministic; a weekend-sized build.
- Scaffold the monorepo, Tauri app, Python sidecar (hello-world over HTTP). ✅ spec 001
- Define the extraction **contract** (Pydantic + TS mirror). ✅ spec 002
- SQLite **schema + migrations**. ✅ spec 003
- **Grid extraction** (color-block localization → CV row count → HSV cell classifier) with
  **golden classifier tests**; **habit labels** read per month via the vision-LLM. spec 004
- **Review & correct** screen (draft over photo; edit cells, habit names, and sleep).
- **Dashboard**: heatmap (recreate the paper grid), monthly %, per-habit streaks, daily totals, **red-line cross-check** flag.
- Sleep + notes entered **manually** for now.

### Phase 2 — Full extraction
- **Sleep** OCR from the written number box.
- **Notes** via vision LLM → review UI (assume ~80% accuracy; make correction fast).
- Multilingual handling (EN/FR/Darija transliteration).

### Phase 3 — Intelligence
- **Month-over-month** trends and habit-level history.
- **Correlations & insights** via LLM over the structured data (my RAG comfort zone). **Frame insights as hypotheses, not conclusions** — with ~31 points/month, correlations are fragile until months accumulate. Deterministic metrics (streaks, completion, trends) are the trustworthy ones early on.
- **Sentiment / theme extraction** over memorable moments.
- Optional: gamification layer (XP, streaks-as-quests) consistent with my other projects.

---

## 10. Best Practices (enforce these)

**Architecture**
- Keep `pipeline/` pure and shell-agnostic (§5). No HTTP/Tauri imports in it, ever.
- The Pydantic contract is the only cross-boundary agreement. Version it; changes are deliberate.
- Determinism first: use **CV for anything structured** (locating/rectifying the grid, classifying cells), **LLM only for free-form handwriting** (habit labels, notes). **Never ask the LLM to count grid cells.** Grid dimensions come from reliable sources, not fragile CV aspect estimates: the **day count** is user-set (defaults to month length) and the **habit-row count** follows from the labels read (one label per row).

**Reliability**
- **Human-in-the-loop is mandatory.** Never auto-commit an extraction. The review screen is a core feature, not a nicety.
- **Golden-image regression tests** for CV: a set of sample photos + known-good JSON; assert the classifier matches. This is the backbone of trust in Phase 1.
- **Idempotent imports** keyed on `(year, month, day)`.
- **Archive raw inputs**: store the original photo + raw extraction JSON per import, so any month can be reprocessed later when the pipeline improves.

**Code quality**
- TypeScript `strict`; Python fully type-hinted; pydantic-validated boundaries.
- Migrations for every schema change (no ad-hoc `ALTER`).
- Structured logging in the sidecar; surface errors to the UI legibly.
- Small, spec-linked commits.

**Security / privacy**
- Local-first. The only egress is the vision LLM call — keep it behind a swappable interface.
- **API key in the OS keychain / secure store**, never in the repo or client bundle. The sidecar reads it from a secure source at runtime.
- No user data in logs beyond what's needed to debug.

---

## 11. Proposed Repo Structure

```
habit-chronicle/
  apps/
    desktop/
      src/                 # React + TS
      src-tauri/           # Rust host, sidecar config
  services/
    pipeline/
      pipeline/            # PURE module: grid, labels, sleep, notes, contract
      api/                 # FastAPI wrapper
      db/                  # SQLite access + migrations
      tests/
        golden/            # sample photos + expected JSON
  specs/                   # NNN-slug.md, the SDD memory
  docs/
    design_system/         # direction 2a (Grand Hotel + Lato); tokens.css + references
    samplePhoto/           # real hand-drawn spreads used as CV/label ground truth
  CLAUDE.md                # this file
```

---

## 12. Design Guidelines

> **Provided.** The design system lives in `docs/design_system/` — **direction 2a**: warm
> paper surfaces, **Grand Hotel** (display) + **Lato** (body), green `#6fa86a` (done), red for
> missed, blue `#4a86c4` (sleep), orange `#e8843c` (flag/selection); no shadows, warm borders.
> `tokens.css` holds the `--hc-*` custom properties (the single source of truth — the frontend
> imports it) and `MonthPanel.dc.html` is the 2a dashboard reference. **Do not invent
> colors/fonts** — pull from the tokens. (The earlier violet/gold idea is dropped.)

---

## 13. First Tasks for Claude Code

Do these in order, spec-first (specs live in `docs/specs/`):
1. ✅ `001-monorepo-scaffold.md` — `apps/desktop` (Tauri v2 + React + TS + Tailwind) and `services/pipeline` (FastAPI sidecar) with a health-check round-trip: React → sidecar → `{status: "ok"}`. **Done.**
2. ✅ `002-extraction-contract.md` — `pipeline/contract.py` (Pydantic) + mirrored TS types. **Done.**
3. ✅ `003-data-model.md` — SQLite schema + first migration + `db/` access layer. **Done.**
4. `004-grid-extraction.md` — color-block localization + CV row count + HSV grid classifier + per-month habit-label reading (vision-LLM, swappable, stubbed in tests); golden classifier tests. **Stop at the phase gate for review before Phase 2.**

Design guidelines are in `docs/design_system/` (direction 2a). Sample spreads are in `docs/samplePhoto/`. Ask Moha for an Anthropic API key (stored in the OS keychain) before running the real label reader.