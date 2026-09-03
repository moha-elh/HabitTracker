"""Grid extraction — heuristic CV, no fiducials (CLAUDE.md §7 Revision, spec 004).

Locate the hand-drawn grid from its own saturated green/red block, rectify it, count rows via
CV (columns = days), classify each cell green/red, and read habit labels via an injected
LabelReader. Pure module: cv2/numpy + the injected reader; no HTTP/Tauri imports.

Reliability rests on the review screen — this is a good first pass with confidence flags, not
ground truth. HSV bounds are calibration knobs (pen/lighting vary); tune per real photos.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from pipeline.contract import Cell, CellStatus, DayFlag, Extraction, Habit, HabitKind
from pipeline.labels import LabelReader

# HSV calibration (OpenCV H is 0..179). ponytail: tune these against real photos if a pen or
# lighting shifts the fills out of range.
GREEN_LO, GREEN_HI = (35, 60, 40), (90, 255, 255)
RED1_LO, RED1_HI = (0, 60, 40), (10, 255, 255)
RED2_LO, RED2_HI = (170, 60, 40), (179, 255, 255)


class GridNotFound(ValueError):
    """The colored grid block couldn't be located — crop closer and retry."""


@dataclass
class GridConfig:
    year: int
    month: int
    days: int = 31
    confidence_threshold: float = 0.6
    # Fraction of the block area below which we declare "grid not found".
    min_area_frac: float = 0.05
    # Labels are read top-to-bottom in reading order, but on a rotated photo the first-read
    # habit can sit at the far (bottom/right) edge of the grid. When True, pair label[r] with
    # the strip from the opposite end so names line up with the correct rows.
    flip_habits: bool = False


@dataclass
class ExtractResult:
    extraction: Extraction
    rectified_png: bytes  # tight grid used for slicing; for the review overlay, not persisted
    rows: int
    reference_png: bytes = b""  # wider crop that keeps the handwritten name margin (display only)
    flags: list = field(default_factory=list)


def _masks(bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    green = cv2.inRange(hsv, GREEN_LO, GREEN_HI)
    red = cv2.inRange(hsv, RED1_LO, RED1_HI) | cv2.inRange(hsv, RED2_LO, RED2_HI)
    return green, red


def classify_patch(bgr_patch: np.ndarray) -> tuple[CellStatus, float]:
    """Median-vote a cell patch → (status, confidence). Confidence = winning-pixel fraction."""
    green, red = _masks(bgr_patch)
    total = bgr_patch.shape[0] * bgr_patch.shape[1]
    if total == 0:
        return CellStatus.empty, 0.0
    g = int(np.count_nonzero(green))
    r = int(np.count_nonzero(red))
    neither = total - g - r
    best = max(
        (g, CellStatus.done), (r, CellStatus.missed), (neither, CellStatus.empty),
        key=lambda t: t[0],
    )
    return best[1], best[0] / total


def _order_points(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as tl, tr, br, bl."""
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array(
        [pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]],
        dtype=np.float32,
    )


def _main_band(density: np.ndarray, frac: float = 0.25) -> tuple[int, int]:
    """Longest contiguous run where density exceeds frac*max — the solid grid band.
    Trims thin protrusions (the sleep-chart line, the detached '30,26%' text) and margins,
    which have far lower per-line coverage than the filled grid."""
    above = density > density.max() * frac
    best_start = best_len = 0
    i, n = 0, len(above)
    while i < n:
        if above[i]:
            j = i
            while j < n and above[j]:
                j += 1
            if j - i > best_len:
                best_len, best_start = j - i, i
            i = j
        else:
            i += 1
    return best_start, best_start + best_len


def _locate_and_rectify(bgr: np.ndarray, min_area_frac: float) -> tuple[np.ndarray, np.ndarray]:
    green, red = _masks(bgr)
    mask = cv2.morphologyEx(green | red, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise GridNotFound("no colored region found")
    block = max(contours, key=cv2.contourArea)
    if cv2.contourArea(block) < min_area_frac * bgr.shape[0] * bgr.shape[1]:
        raise GridNotFound("colored region too small to be the grid")

    # Deskew by the block's tilt so cells become axis-aligned.
    angle = cv2.minAreaRect(block)[2]
    if angle < -45:
        angle += 90
    elif angle > 45:
        angle -= 90
    h, w = bgr.shape[:2]
    rot = cv2.warpAffine(
        bgr, cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0), (w, h),
        borderValue=(255, 255, 255),
    )

    # Crop to the solid grid band on each axis: the filled grid has near-full coverage per
    # row/column, while chart lines and the '%' text are thin (low coverage) and get trimmed.
    gm, rm = _masks(rot)
    m = gm | rm
    y0, y1 = _main_band(m.sum(axis=1).astype(np.float64))
    x0, x1 = _main_band(m.sum(axis=0).astype(np.float64))
    if y1 - y0 < 10 or x1 - x0 < 10:
        raise GridNotFound("grid band too small after deskew")
    rect = rot[y0:y1, x0:x1]  # tight color block, used for cell slicing
    # Display-only reference: extend left to x=0 for the handwritten name margin, and pad the
    # grid's y-band a little so the top/bottom row labels are not clipped (they overhang the
    # colored cells). The charts sit well above, so a small pad keeps them out.
    # ponytail: name margin assumed on the low-x side of the deskewed grid (Moha's journal
    # layout); revisit if a future photo puts names on the right.
    py = int(0.06 * (y1 - y0))
    reference = rot[max(0, y0 - py) : min(rot.shape[0], y1 + py), 0:x1]
    return rect, reference


def _unique_names(labels: list[str], rows: int) -> list[str]:
    """Blank → placeholder, and de-duplicate (contract forbids duplicate/blank habit names)."""
    out: list[str] = []
    seen: set[str] = set()
    for i in range(rows):
        name = (labels[i].strip() if i < len(labels) else "") or f"Habit {i + 1}"
        base, k = name, 2
        while name in seen:
            name = f"{base} ({k})"
            k += 1
        seen.add(name)
        out.append(name)
    return out


def extract(image_bytes: bytes, config: GridConfig, reader: LabelReader) -> ExtractResult:
    bgr = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("could not decode image")

    rect, reference = _locate_and_rectify(bgr, config.min_area_frac)
    h, w = rect.shape[:2]

    # Counts come from reliable sources, not fragile CV aspect: rows = the habit labels the
    # reader returns; cols = the day count the caller sets (grids vary; the user knows it).
    # Days are the longer axis (days > habits for this journal), so orientation follows w vs h.
    cols = config.days
    labels = reader.read(image_bytes)
    if labels:
        rows = len(labels)
    else:  # offline / no key: estimate rows from ~square cells so the grid still renders
        longer, shorter = max(w, h), min(w, h)
        rows = max(1, round(shorter / (longer / cols)))
    days_along_x = w >= h
    flags: list[DayFlag] = []
    names = _unique_names(labels, rows)

    cells: list[Cell] = []
    for r in range(rows):
        rr = (rows - 1 - r) if config.flip_habits else r  # which physical strip name[r] maps to
        for c in range(cols):
            if days_along_x:
                y0, y1, x0, x1 = rr * h // rows, (rr + 1) * h // rows, c * w // cols, (c + 1) * w // cols
            else:
                x0, x1, y0, y1 = rr * w // rows, (rr + 1) * w // rows, c * h // cols, (c + 1) * h // cols
            # inner 50% avoids drawn borders / bleed
            py, px = (y1 - y0) // 4, (x1 - x0) // 4
            patch = rect[y0 + py : y1 - py, x0 + px : x1 - px]
            status, conf = classify_patch(patch)
            if status is CellStatus.empty:
                continue  # unmarked cell — not tracked (contract/spec 003)
            cells.append(Cell(day=c + 1, habit=names[r], status=status, confidence=round(conf, 3)))
            if conf < config.confidence_threshold:
                flags.append(DayFlag(day=c + 1, reason=f"low-confidence cell: {names[r]}"))

    habits = [Habit(name=n, kind=HabitKind.build, sort_order=i) for i, n in enumerate(names)]
    extraction = Extraction(
        year=config.year, month=config.month, habits=habits, cells=cells, flags=flags
    )
    ok, png = cv2.imencode(".png", rect)
    ok_ref, ref_png = cv2.imencode(".png", reference)
    return ExtractResult(
        extraction,
        png.tobytes() if ok else b"",
        rows,
        reference_png=ref_png.tobytes() if ok_ref else b"",
        flags=flags,
    )
