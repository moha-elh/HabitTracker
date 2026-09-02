# Spec 004 — Grid extraction (heuristic CV + per-month label reading, review-first)

Status: **implemented (offline green)** · Phase: 1 · Depends on: 002, 003 · Blocks: review screen, dashboard

> Implementation note (2026-09-02): CV classifier + full pipeline verified on a **synthetic**
> grid (deterministic), and the provider-agnostic `LabelReader` verified live against a real
> `docs/samplePhoto/` image via Gemini free tier (`gemini-flash-lite-latest`, OpenAI-compat).
> AC 2's golden test uses synthetic solid-color cells rather than a hand-labeled real rectified
> crop.
>
> Update (2026-09-02, after review-screen testing): the localizer was reworked from a raw
> minAreaRect warp to **deskew + projection-profile band crop** — it drops the detached red
> "30,26%" text and margins that were inflating the block. On both `docs/samplePhoto/` grids it
> now finds **13 rows** and computes ~29.3% completion vs the drawn 30.26%; cell alignment is
> tight. Residual per-cell errors remain review-backed.

## Intent
Extract the done/missed habit grid **and its habit labels** from a **handheld photo of the
existing hand-drawn journal** — the real spreads in `docs/samplePhoto/`, which have **no
fiducials and no printed template**. Produce a draft `Extraction` (habits + cells, spec 002)
for human review.

The **habit list changes every month**, so it is read from the image per import — not stored
as config. Reliability comes from the **review screen** (CLAUDE.md §10, human-in-the-loop):
the user keeps the analog grid as-is and corrects the draft by hand.

### Supersedes (deliberate divergence from CLAUDE.md, per user decision — see memory)
- §7 **paper template / 4 corner fiducials** — not used; the grid is located from its own
  colored block.
- §4 **fiducial registration → fixed cell coordinates as constants** — replaced by per-image
  rectification + config-free slicing.
- §9/§13 implied **static habit config** — habits are extracted per month instead.

### Division of labor (stays true to §10)
- **CV (deterministic)** owns everything structured: locating the grid, rectifying it,
  counting rows/columns, and classifying each cell green/red. *The LLM never counts cells.*
- **Vision-LLM (swappable, the only egress)** owns only free-form handwriting: reading the
  **text** of the habit row labels. It is isolated behind an interface with a manual fallback.

## Inputs / Outputs
- **Input:**
  - `image_bytes` — a photo of the grid page (roughly cropped to the grid; any rotation).
  - `GridConfig` — small, non-habit config: `days: int = 31`, `orientation` hint,
    HSV thresholds, confidence threshold. **No habit names here** (they're extracted).
  - `label_reader: LabelReader` — injected; reads label text from a cropped strip. Real impl
    calls the vision-LLM; tests inject a stub. A `None`/disabled reader ⇒ blank labels the
    user fills in review (local-first fallback).
- **Output:** a validated `Extraction` with:
  - `habits[]` — names read from the label strip (in row order), `kind` defaulted to `build`
    (the user flips eliminate-habits like "Quit sugar" in review), `sort_order` = row index.
  - `cells[]` — one per non-blank `(day, habit)`, `status ∈ done|missed|empty`, `confidence`.
  - `flags[]` — low-confidence cells, and any **row-count vs label-count mismatch**.
  - the rectified grid image (for the review overlay; not persisted).

## Pipeline (`pipeline/grid.py`, pure module — cv2/numpy + the injected reader; no HTTP/Tauri)
1. **Color mask** — BGR→HSV; keep vivid green/red only (paper, dots, pencil text, thin chart
   lines fall out).
2. **Locate grid** — largest connected component → external contour → `cv2.minAreaRect` → the
   grid's 4 corners. The colored block *is* the registration target (replaces fiducials). Too
   small / non-rectangular ⇒ raise a clear "couldn't locate the grid" error.
3. **Rectify** — `getPerspectiveTransform` + `warpPerspective` → axis-aligned rectangle.
4. **Count rows (CV)** — columns are known (`days = 31`); estimate rows from the rectified
   aspect ratio assuming ~square cells (`rows ≈ round(height / (width/31))`), refined by
   detecting the mask's row bands. This keeps counting deterministic (§10).
5. **Read labels (LLM)** — crop the label strip adjacent to the grid; `label_reader` returns
   an ordered `list[str]`. If `len(labels) != rows` → keep CV's `rows`, pad/truncate labels to
   match, and add a mismatch `flag`. Disabled reader ⇒ `["" ] * rows`.
6. **Slice** — divide the rectangle into `rows × 31` by even spacing; `orientation` hint
   resolves which axis is days (samples are rotated 90°); transpose as needed.
7. **Classify each cell** — median hue/sat of an inner patch (central ~50%, avoiding borders)
   → `done` / `missed` / `empty`; `confidence` = agreeing-pixel fraction. Below threshold →
   `flag`.
8. Build habits (labels ↔ rows) + cells, **validate** against `Extraction`, return it + the
   rectified image.

## LabelReader interface (§4/§10 — swappable, only egress, key in OS keychain)
```python
class LabelReader(Protocol):
    def read(self, strip_png: bytes, expected_rows: int) -> list[str]: ...
```
- `AnthropicLabelReader` — calls a vision-capable Claude model (model id from **env**, never
  hardcoded — §3); API key from the **OS keychain** (Windows Credential Manager via `keyring`),
  never in the repo or bundle (§10). Prompt: "read these N handwritten row labels top-to-bottom,
  return JSON list of strings."
- `StubLabelReader(labels)` — returns fixed labels; used in all unit tests so **no network in
  the test suite**.

## Acceptance criteria (testable — realistic about what's assertable)
1. **Classifier (deterministic):** `classify_patch` → `done` (green), `missed` (red),
   `empty` (white/low-sat) on synthetic patches.
2. **Golden classifier accuracy:** on a **hand-cropped, rectified** grid crop from a
   `docs/samplePhoto/` image + hand-labeled expected JSON, the classifier matches **≥ 95%** of
   labeled cells (tests the reliable color step, not the fragile rectifier).
3. **Full-pipeline smoke (stub reader):** `extract(image_bytes, config, StubLabelReader(...))`
   on a sample photo runs without error, returns an `Extraction` that **validates against the
   contract**, `habits` come from the stub, `len(cells) == rows*31 − empties`. Un-cropped
   accuracy is **not** asserted (review's job).
4. Low-confidence cells and any row/label mismatch appear in `flags[]`.
5. Labels ↔ rows alignment holds: `habits[i].sort_order == i`, and every `cell.habit` is a
   name in `habits` (contract referential integrity passes).
6. `pipeline/grid.py` imports no `fastapi`/`tauri`/`uvicorn`/`http`; the only egress is via the
   injected `LabelReader` (grep clean for framework imports).
7. Network isolation: the whole `pytest` suite runs with **no** outbound call (stub reader).

## Edge cases
- **Rotation / orientation:** samples are rotated 90° — resolve via hint / longer-axis
  heuristic; transpose the slice grid.
- **Label misread / count mismatch:** CV's row count wins; labels padded/truncated; flagged for
  review. Blank labels (disabled reader) are valid and expected to be typed in review.
- **Occlusion** (elastic band, shadow): low-confidence → flagged; no inpainting.
- **Spine curvature:** residual drift near the spine accepted, caught in review.
- **No API key / offline:** reader disabled → blank habit names, pipeline still produces the
  grid; local-first preserved (§10).

## Out of scope (deferred)
- **Sleep line & "Total of habits" line** digitizing — manual in Phase 1; Total is *derived*
  from the grid (§2). Drawn-total cross-check and `30.26%` completion OCR: later.
- **Notes** (memorable moments vision-LLM) — Phase 2, a separate reader.
- **`kind` inference** (build vs eliminate) — defaulted to `build`; user flips in review.
- **Robust auto-orientation / page de-curving** — start with hint + global warp.
  `# ponytail: global warp + aspect-ratio row count; upgrade only if review churn proves it.`

## Dependencies added
`opencv-python`, `numpy` (CV), `anthropic` (vision-LLM), `keyring` (OS keychain for the API
key). Added to `services/pipeline/pyproject.toml`.

## Verification runbook
1. `uv run pytest tests/test_grid.py` → classifier + golden + smoke green, no network (AC 1–7).
2. `grep -rE "fastapi|tauri|uvicorn|http" services/pipeline/pipeline/grid.py` → no hits (AC 6).
3. Manual: with `ANTHROPIC_API_KEY` in the keychain + model env set, run `extract` on a real
   sample with `AnthropicLabelReader` and eyeball the read habit names (not a unit test).
4. Full suite `uv run pytest` stays green.
