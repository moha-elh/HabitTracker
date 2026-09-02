import cv2
import numpy as np
import pytest

from pipeline.contract import CellStatus, Extraction
from pipeline.grid import GridConfig, GridNotFound, classify_patch, extract
from pipeline.labels import StubLabelReader

GREEN = (0, 180, 0)
RED = (0, 0, 200)
CELL = 16
ROWS, COLS = 6, 31


def _patch(bgr_color):
    return np.full((20, 20, 3), bgr_color, np.uint8)


def _expected_status(r, c) -> CellStatus:
    if (r + c) % 7 == 0:
        return CellStatus.empty  # leave white
    return CellStatus.done if (r + c) % 2 == 0 else CellStatus.missed


def _synthetic_grid() -> tuple[bytes, dict]:
    img = np.full((ROWS * CELL, COLS * CELL, 3), 255, np.uint8)
    expected = {}
    for r in range(ROWS):
        for c in range(COLS):
            st = _expected_status(r, c)
            if st is CellStatus.empty:
                continue
            color = GREEN if st is CellStatus.done else RED
            cv2.rectangle(img, (c * CELL, r * CELL), ((c + 1) * CELL - 1, (r + 1) * CELL - 1), color, -1)
            expected[(r, c)] = st
    ok, png = cv2.imencode(".png", img)
    return png.tobytes(), expected


def test_classify_patch_colors():
    assert classify_patch(_patch(GREEN))[0] is CellStatus.done
    assert classify_patch(_patch(RED))[0] is CellStatus.missed
    assert classify_patch(_patch((255, 255, 255)))[0] is CellStatus.empty


def test_extract_synthetic_grid():
    image, expected = _synthetic_grid()
    names = [f"Habit {i}" for i in range(ROWS)]
    result = extract(image, GridConfig(year=2026, month=8, days=COLS), StubLabelReader(names))

    # validates against the contract and recovers the row count
    assert isinstance(result.extraction, Extraction)
    assert result.rows == ROWS
    assert [h.name for h in result.extraction.habits] == names

    # ≥95% of non-empty cells classified correctly
    actual = {(c.day - 1, c.habit): c.status for c in result.extraction.cells}
    hits = sum(
        1 for (r, col), st in expected.items() if actual.get((col, names[r])) is st
    )
    assert hits / len(expected) >= 0.95
    # empty cells produced no entry
    assert len(result.extraction.cells) == len(expected)


def test_grid_not_found_on_blank():
    blank = np.full((200, 200, 3), 255, np.uint8)
    ok, png = cv2.imencode(".png", blank)
    with pytest.raises(GridNotFound):
        extract(png.tobytes(), GridConfig(year=2026, month=8), StubLabelReader([]))
