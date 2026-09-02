"""Memorable-moments reading — the swappable vision interface for the left page (spec 008).

Mirrors labels.py: the pure core depends only on this Protocol; the concrete *network*
implementation lives OUTSIDE this package (services/pipeline/readers.py) so `pipeline/` stays
import-clean of HTTP. The LLM reads the handwritten daily lines verbatim (EN/FR/Darija).
"""

from __future__ import annotations

from typing import Protocol


class MomentsReader(Protocol):
    def read(self, image_png: bytes) -> list[dict]:
        """Return the handwritten daily moments as ``[{"day": int, "text": str}, ...]``."""
        ...


class NullMomentsReader:
    """Offline / disabled: no moments — the user types them in review (local-first fallback)."""

    def read(self, image_png: bytes) -> list[dict]:
        return []


class StubMomentsReader:
    """Fixed moments for tests — keeps the suite offline."""

    def __init__(self, moments: list[dict]):
        self._m = list(moments)

    def read(self, image_png: bytes) -> list[dict]:
        return list(self._m)
