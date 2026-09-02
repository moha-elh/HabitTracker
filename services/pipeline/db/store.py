"""SQLite access layer — the single writer to the database (CLAUDE.md §3, §6).

Turns a validated Extraction (spec 002) into persisted rows, idempotently. Imports only
stdlib sqlite3 and the pure contract; no HTTP/Tauri/framework concerns.
"""

from __future__ import annotations

import calendar
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone

from pipeline.contract import CellStatus, Extraction

# Ordered migrations; index i applies when user_version < i+1. Migration 1 = full schema (§6).
# ponytail: PRAGMA user_version runner — a single-user local file doesn't need Alembic.
_SCHEMA_V1 = """
CREATE TABLE habits (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'build',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE months (
    id INTEGER PRIMARY KEY,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    imported_at TEXT NOT NULL,
    photo_path TEXT,
    raw_extraction_path TEXT,
    notes_ocr_ok INTEGER NOT NULL DEFAULT 0,
    UNIQUE(year, month)
);
CREATE TABLE entries (
    id INTEGER PRIMARY KEY,
    month_id INTEGER NOT NULL REFERENCES months(id) ON DELETE CASCADE,
    day INTEGER NOT NULL,
    habit_id INTEGER NOT NULL REFERENCES habits(id),
    done INTEGER NOT NULL,
    UNIQUE(month_id, day, habit_id)
);
CREATE TABLE metrics (
    id INTEGER PRIMARY KEY,
    month_id INTEGER NOT NULL REFERENCES months(id) ON DELETE CASCADE,
    day INTEGER NOT NULL,
    sleep_hours REAL,
    UNIQUE(month_id, day)
);
CREATE TABLE moments (
    id INTEGER PRIMARY KEY,
    month_id INTEGER NOT NULL REFERENCES months(id) ON DELETE CASCADE,
    day INTEGER NOT NULL,
    weekday TEXT,
    text TEXT NOT NULL,
    lang TEXT,
    UNIQUE(month_id, day)
);
"""

MIGRATIONS: list[str] = [_SCHEMA_V1]


@dataclass
class MonthRecord:
    month_id: int
    year: int
    month: int
    entries: int
    metrics: int
    moments: int


def connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    for i in range(version, len(MIGRATIONS)):
        conn.executescript(MIGRATIONS[i])
        conn.execute(f"PRAGMA user_version = {i + 1}")
    conn.commit()


def commit_extraction(
    conn: sqlite3.Connection,
    ex: Extraction,
    *,
    photo_path: str | None = None,
    raw_extraction_path: str | None = None,
    notes_ocr_ok: bool = False,
) -> MonthRecord:
    """Persist an Extraction idempotently. Re-committing a month fully replaces its rows."""
    _check_calendar(ex)
    with conn:  # atomic: commit on success, rollback on exception
        month_id = _upsert_month(conn, ex, photo_path, raw_extraction_path, notes_ocr_ok)
        habit_ids = _upsert_habits(conn, ex)
        # Delete-then-insert children so a re-import drops stale rows (spec 003 idempotency).
        for table in ("entries", "metrics", "moments"):
            conn.execute(f"DELETE FROM {table} WHERE month_id = ?", (month_id,))

        n_entries = 0
        for c in ex.cells:
            if c.status is CellStatus.empty:
                continue  # unmarked cell — not tracked that day
            conn.execute(
                "INSERT INTO entries(month_id, day, habit_id, done) VALUES(?, ?, ?, ?)",
                (month_id, c.day, habit_ids[c.habit], 1 if c.status is CellStatus.done else 0),
            )
            n_entries += 1

        n_metrics = 0
        for s in ex.sleep:
            if s.hours is None:
                continue
            conn.execute(
                "INSERT INTO metrics(month_id, day, sleep_hours) VALUES(?, ?, ?)",
                (month_id, s.day, s.hours),
            )
            n_metrics += 1

        for m in ex.moments:
            conn.execute(
                "INSERT INTO moments(month_id, day, weekday, text, lang) VALUES(?, ?, ?, ?, ?)",
                (month_id, m.day, m.weekday, m.text, m.lang),
            )

    return MonthRecord(month_id, ex.year, ex.month, n_entries, n_metrics, len(ex.moments))


def _check_calendar(ex: Extraction) -> None:
    last = calendar.monthrange(ex.year, ex.month)[1]
    days = {c.day for c in ex.cells} | {s.day for s in ex.sleep} | {m.day for m in ex.moments}
    bad = sorted(d for d in days if d > last)
    if bad:
        raise ValueError(f"day(s) {bad} exceed {ex.year}-{ex.month:02d} length ({last})")


def _upsert_month(
    conn: sqlite3.Connection,
    ex: Extraction,
    photo_path: str | None,
    raw_extraction_path: str | None,
    notes_ocr_ok: bool,
) -> int:
    conn.execute(
        """
        INSERT INTO months(year, month, imported_at, photo_path, raw_extraction_path, notes_ocr_ok)
        VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(year, month) DO UPDATE SET
            imported_at = excluded.imported_at,
            photo_path = excluded.photo_path,
            raw_extraction_path = excluded.raw_extraction_path,
            notes_ocr_ok = excluded.notes_ocr_ok
        """,
        (
            ex.year,
            ex.month,
            datetime.now(timezone.utc).isoformat(),
            photo_path,
            raw_extraction_path,
            1 if notes_ocr_ok else 0,
        ),
    )
    row = conn.execute(
        "SELECT id FROM months WHERE year = ? AND month = ?", (ex.year, ex.month)
    ).fetchone()
    return row["id"]


def _upsert_habits(conn: sqlite3.Connection, ex: Extraction) -> dict[str, int]:
    ids: dict[str, int] = {}
    for h in ex.habits:
        conn.execute(
            """
            INSERT INTO habits(name, kind, sort_order, active) VALUES(?, ?, ?, 1)
            ON CONFLICT(name) DO UPDATE SET
                kind = excluded.kind, sort_order = excluded.sort_order, active = 1
            """,
            (h.name, h.kind.value, h.sort_order),
        )
        row = conn.execute("SELECT id FROM habits WHERE name = ?", (h.name,)).fetchone()
        ids[h.name] = row["id"]
    return ids
