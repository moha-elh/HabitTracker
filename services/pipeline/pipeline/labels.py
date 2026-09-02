"""Habit-label reading — the swappable vision interface (CLAUDE.md §5/§10).

The pure core depends only on this Protocol. Concrete *network* implementations live OUTSIDE
this pure package (see services/pipeline/readers.py) so `pipeline/` stays import-clean of HTTP.
The habit list changes monthly, so labels are read from the photo each import; the LLM reads
only the handwriting — it never counts rows/cells (CV does that).
"""

from __future__ import annotations

from typing import Protocol


class LabelReader(Protocol):
    def read(self, image_png: bytes) -> list[str]:
        """Return ALL habit row labels, top-to-bottom. Its length is the habit-row count —
        the grid's rows come from here, not from fragile CV aspect estimates."""
        ...


class NullLabelReader:
    """Offline / disabled: no labels — the caller falls back to a CV row estimate + blank
    names the user fills in review (local-first fallback)."""

    def read(self, image_png: bytes) -> list[str]:
        return []


class StubLabelReader:
    """Fixed labels for tests — keeps the suite offline."""

    def __init__(self, labels: list[str]):
        self._labels = list(labels)

    def read(self, image_png: bytes) -> list[str]:
        return list(self._labels)
