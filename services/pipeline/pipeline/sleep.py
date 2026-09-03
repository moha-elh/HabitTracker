"""Sleep-line reading — the swappable vision interface for the blue sleep chart (spec 010).

Mirrors labels.py / notes.py: the pure core depends only on this Protocol; the concrete
*network* implementation lives OUTSIDE this package (services/pipeline/readers.py). The LLM
estimates each day's hours off the hand-drawn blue line; the review screen corrects it.
"""

from __future__ import annotations

from typing import Protocol


class SleepReader(Protocol):
    def read(self, image_png: bytes) -> list[dict]:
        """Return the blue sleep line as ``[{"day": int, "hours": float}, ...]``."""
        ...


class NullSleepReader:
    """Offline / disabled: no sleep — the user types it in review (local-first fallback)."""

    def read(self, image_png: bytes) -> list[dict]:
        return []


class StubSleepReader:
    """Fixed sleep for tests — keeps the suite offline."""

    def __init__(self, sleep: list[dict]):
        self._s = list(sleep)

    def read(self, image_png: bytes) -> list[dict]:
        return list(self._s)
