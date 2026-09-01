# Habit Chronicle — Project Context

> Working name: **Habit Chronicle** (repo slug `habit-chronicle`). Rename freely — it's referenced only in paths below.

This document is the single source of truth for Claude Code working on this project. Read it fully before writing any code. When something here conflicts with an ad-hoc chat instruction, ask before diverging.

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
- **Sleep (blue line) is the ONLY independent continuous metric.** It's the one thing that can't be computed from the grid, so it's the only chart that genuinely needs digitizing — or, preferably, read from a written number (see §7, paper template).
- **Memorable moments** are one free-text line per day, multilingual.
- **A "month" is the unit of import.** Imports are idempotent: re-importing the same month updates rows keyed on `(year, month, day)`, never duplicates.

**Extraction targets collapse to three:** the grid (CV), sleep (OCR or manual), notes (vision LLM). Everything else is arithmetic.

---

## 3. Tech Stack

**Frontend / shell — desktop app**
- **Tauri v2** (Rust host) — native desktop app, small binary, secure.
- **React + TypeScript + Vite** for the UI.
- **Tailwind CSS** for styling (design system per `docs/design-guidelines.md`).
- Charts: **Recharts** (or visx); the habit heatmap as custom SVG/CSS.

**Pipeline / backend — Python sidecar**
- **Python 3.11+**, packaged with **PyInstaller** and shipped as a **Tauri sidecar binary**.
- Runs a local **FastAPI** (uvicorn) server on a loopback port; Tauri spawns it on launch and terminates it on exit. React talks to it over `http://127.0.0.1:<port>`.
- **OpenCV** (`opencv-python`) + **NumPy** for image processing; `cv2.aruco` for fiducial markers.
- **Anthropic SDK** for the vision step (a current vision-capable Claude model, **configurable via env** — never hardcode a model string).
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
   │    ├ registration  (flatten via fiducials)│
   │    ├ grid          (HSV cell classifier)  │
   │    ├ sleep         (OCR / passthrough)    │
   │    ├ notes         (vision LLM)           │
   │    └ contract.py   (pydantic schemas)     │
   │  db/           SQLite (single writer)     │
   └──────────────────────────────────────────┘
```

**Data flow (one import):**
1. User drops a photo → frontend POSTs the image to the sidecar.
2. `registration`: detect 4 corner fiducials → perspective-warp to a canonical rectangle → crop into grid / sleep / notes regions.
3. `grid`: for each known cell coordinate, sample dominant color → HSV threshold → `done | missed | empty`.
4. `sleep`: OCR the written number (or accept a value entered in the review UI).
5. `notes`: send the notes crop to the vision LLM → structured `{day, weekday, text}[]`.
6. Sidecar returns a **draft** extraction (JSON matching the contract). **Nothing is saved yet.**
7. **Review screen**: draft overlaid on the photo; user corrects errors; the red-line cross-check highlights suspect days.
8. On confirm → sidecar writes to SQLite (idempotent on `(year, month, day)`), and archives the raw photo + raw extraction JSON.
9. Dashboard + insights read from SQLite.

**Local-first & private:** the only network call is the vision LLM for notes. Keep it isolated behind an interface so it can later be swapped for a local model or disabled (notes become photo-only).

---

## 5. The Non-Negotiable Boundary

`pipeline/` is a **pure module** with a plain function interface and **no knowledge of HTTP, Tauri, or the UI**:

```python
extract(image_bytes, template_spec) -> Extraction   # image -> structured draft
commit(extraction, db) -> MonthRecord                # draft -> persisted rows
```

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

## 7. Paper Template (co-designed analog side)

The software depends on the paper being machine-readable. Treat the template as a project deliverable (`docs/paper-template.md` + a printable). Requirements:

- **Four corner fiducials** (ArUco markers or bold registration crosses) → deterministic perspective correction. This alone removes most angled-photo pain.
- **Fixed grid geometry** month to month → cell coordinates become constants, not something re-detected each import.
- **A small box to write the Sleep number** next to the chart → OCR two digits instead of digitizing a hand-drawn line. Keep drawing the line too (it's nice, and it's the QA signal for totals).
- Keep the ritual beautiful — it just also happens to be a form.

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
- Scaffold the monorepo, Tauri app, Python sidecar (hello-world over HTTP).
- Define the extraction **contract** (Pydantic + TS mirror).
- SQLite **schema + migrations**.
- **Grid extraction** (fiducial registration → HSV cell classifier) with **golden-image tests**.
- **Review & correct** screen (draft over photo; edit cells).
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
- Determinism first: use **CV for anything structured** (the grid), **LLM only for free-form handwriting** (notes). Never ask the LLM to count grid cells.

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
      pipeline/            # PURE module: registration, grid, sleep, notes, contract
      api/                 # FastAPI wrapper
      db/                  # SQLite access + migrations
      tests/
        golden/            # sample photos + expected JSON
  specs/                   # NNN-slug.md, the SDD memory
  docs/
    design-guidelines.md   # ← I will provide this (see §12)
    paper-template.md
  CLAUDE.md                # this file
```

---

## 12. Design Guidelines

> **PLACEHOLDER — to be filled in by me (Moha).** See `docs/design-guidelines.md`.
> The frontend must follow that document for color, typography, spacing, and component style. Until it exists, do not invent a visual identity — scaffold with neutral, unstyled components and leave styling hooks (Tailwind classes centralized) so the design system drops in cleanly. Likely starting point: a violet/gold, Strava-inspired system consistent with my other work, but treat the design doc as authoritative once provided.

---

## 13. First Tasks for Claude Code

Do these in order, spec-first:
1. Write `specs/001-monorepo-scaffold.md`, then scaffold `apps/desktop` (Tauri v2 + React + TS + Tailwind) and `services/pipeline` (FastAPI + PyInstaller sidecar) with a working health-check round-trip: React → sidecar → `{status: "ok"}`.
2. Write `specs/002-extraction-contract.md`; implement `pipeline/contract.py` (Pydantic) + the mirrored TS types.
3. Write `specs/003-data-model.md`; implement the SQLite schema + first migration + `db/` access layer.
4. Write `specs/004-grid-extraction.md`; implement fiducial registration + HSV grid classifier; add golden-image tests. **Stop at the phase gate for review before Phase 2.**

Ask me for the design guidelines and a sample photo (with the new fiducial template) before building the review screen or dashboard.