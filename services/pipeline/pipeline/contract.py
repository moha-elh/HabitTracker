"""Extraction contract — the single cross-boundary agreement (CLAUDE.md §5).

The draft produced from one month's photo, before any persistence. Pure module:
no HTTP/Tauri/framework imports. Mirrored 1:1 in apps/desktop/src/contract.ts.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field, field_validator, model_validator

# Bump deliberately on any schema change (§10). The TS mirror must match.
CONTRACT_VERSION = 1


class HabitKind(str, Enum):
    build = "build"
    eliminate = "eliminate"  # "green" = successfully avoided (§6)


class CellStatus(str, Enum):
    done = "done"
    missed = "missed"
    empty = "empty"


def _nonblank(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("must not be blank")
    return v


class Habit(BaseModel):
    name: str
    kind: HabitKind = HabitKind.build
    sort_order: int

    _strip_name = field_validator("name")(_nonblank)


class Cell(BaseModel):
    day: int = Field(ge=1, le=31)
    habit: str  # matches a Habit.name
    status: CellStatus
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)

    _strip_habit = field_validator("habit")(_nonblank)


class SleepReading(BaseModel):
    day: int = Field(ge=1, le=31)
    hours: float | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class Moment(BaseModel):
    day: int = Field(ge=1, le=31)
    weekday: str | None = None
    text: str
    lang: str | None = None  # best-effort 'en'|'fr'|'dar' or None

    _strip_text = field_validator("text")(_nonblank)


class DayFlag(BaseModel):
    day: int = Field(ge=1, le=31)
    reason: str  # e.g. "grid total 8 != drawn red line 6"

    _strip_reason = field_validator("reason")(_nonblank)


class Extraction(BaseModel):
    contract_version: int = CONTRACT_VERSION
    year: int
    month: int = Field(ge=1, le=12)
    habits: list[Habit] = Field(default_factory=list)
    cells: list[Cell] = Field(default_factory=list)
    sleep: list[SleepReading] = Field(default_factory=list)
    moments: list[Moment] = Field(default_factory=list)
    flags: list[DayFlag] = Field(default_factory=list)

    @field_validator("contract_version")
    @classmethod
    def _version_matches(cls, v: int) -> int:
        if v != CONTRACT_VERSION:
            raise ValueError(f"contract_version {v} != CONTRACT_VERSION {CONTRACT_VERSION}")
        return v

    @model_validator(mode="after")
    def _integrity(self) -> Extraction:
        names = [h.name for h in self.habits]
        if len(set(names)) != len(names):
            raise ValueError("duplicate habit name")
        known = set(names)
        seen: set[tuple[int, str]] = set()
        for c in self.cells:
            if c.habit not in known:
                raise ValueError(f"cell references unknown habit {c.habit!r}")
            key = (c.day, c.habit)
            if key in seen:
                raise ValueError(f"duplicate cell for day {c.day} habit {c.habit!r}")
            seen.add(key)
        for label, items in (("sleep", self.sleep), ("moment", self.moments)):
            days = [i.day for i in items]
            if len(set(days)) != len(days):
                raise ValueError(f"duplicate {label} for a day")
        return self
