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

# Migration 2: keep the source photos so the dashboard can show them back (spec 012).
# Stored as self-describing data-URL TEXT (single user, ~12 months/yr).
# ponytail: data-URL in sqlite; move to on-disk files if the DB ever bloats.
_SCHEMA_V2 = """
ALTER TABLE months ADD COLUMN grid_image TEXT;
ALTER TABLE months ADD COLUMN moments_image TEXT;
"""

# Migration 3: per-month toys/derivations that live with the month (spec 013).
# confetti = the silly click counter; ai_review = the cached LLM review markdown (cached so the
# dashboard and insights page don't re-call the model on every open).
_SCHEMA_V3 = """
ALTER TABLE months ADD COLUMN confetti INTEGER NOT NULL DEFAULT 0;
ALTER TABLE months ADD COLUMN ai_review TEXT;
"""

MIGRATIONS: list[str] = [_SCHEMA_V1, _SCHEMA_V2, _SCHEMA_V3]


@dataclass
class MonthRecord:
    month_id: int
    year: int
    month: int
    entries: int
    metrics: int
    moments: int


def connect(path: str) -> sqlite3.Connection:
    # check_same_thread=False: FastAPI runs sync routes in a threadpool, so the single
    # connection is reused across threads. Safe here — single-user, single writer (§3), rare
    # writes; sqlite's own locking covers the rest.
    conn = sqlite3.connect(path, check_same_thread=False)
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
    grid_image: str | None = None,
    moments_image: str | None = None,
    notes_ocr_ok: bool = False,
) -> MonthRecord:
    """Persist an Extraction idempotently. Re-committing a month fully replaces its rows.
    Source images (data URLs) are kept; passing None on a re-commit preserves the stored ones."""
    _check_calendar(ex)
    with conn:  # atomic: commit on success, rollback on exception
        month_id = _upsert_month(conn, ex, grid_image, moments_image, notes_ocr_ok)
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


def list_months(conn: sqlite3.Connection) -> list[dict]:
    """Committed months, newest first, with a marked-cell count (spec 007)."""
    rows = conn.execute(
        """
        SELECT m.year, m.month, m.imported_at,
               (SELECT COUNT(*) FROM entries e WHERE e.month_id = m.id) AS entries
        FROM months m
        ORDER BY m.year DESC, m.month DESC
        """
    ).fetchall()
    return [dict(r) for r in rows]


def load_month(conn: sqlite3.Connection, year: int, month: int) -> dict | None:
    """Full month payload for the dashboard, or None if the month isn't committed (spec 007).
    Habits are those that appear in this month's entries (month↔habit link is only via entries)."""
    m = conn.execute(
        "SELECT id, confetti, ai_review FROM months WHERE year = ? AND month = ?", (year, month)
    ).fetchone()
    if m is None:
        return None
    mid = m["id"]
    habits = conn.execute(
        """
        SELECT DISTINCT h.name, h.kind, h.sort_order
        FROM entries e JOIN habits h ON h.id = e.habit_id
        WHERE e.month_id = ?
        ORDER BY h.sort_order
        """,
        (mid,),
    ).fetchall()
    entries = conn.execute(
        """
        SELECT e.day, h.name AS habit, e.done
        FROM entries e JOIN habits h ON h.id = e.habit_id
        WHERE e.month_id = ?
        ORDER BY h.sort_order, e.day
        """,
        (mid,),
    ).fetchall()
    sleep = conn.execute(
        "SELECT day, sleep_hours AS hours FROM metrics WHERE month_id = ? ORDER BY day", (mid,)
    ).fetchall()
    moments = conn.execute(
        "SELECT day, weekday, text FROM moments WHERE month_id = ? ORDER BY day", (mid,)
    ).fetchall()
    return {
        "year": year,
        "month": month,
        "days": calendar.monthrange(year, month)[1],
        "habits": [dict(h) for h in habits],
        "entries": [dict(e) for e in entries],
        "sleep": [dict(s) for s in sleep],
        "moments": [dict(x) for x in moments],
        "confetti": m["confetti"],
        "review": m["ai_review"],  # cached LLM review markdown, or None
    }


def get_confetti(conn: sqlite3.Connection, year: int, month: int) -> int | None:
    """The stored confetti click count, or None if the month isn't committed (spec 013)."""
    row = conn.execute("SELECT confetti FROM months WHERE year = ? AND month = ?", (year, month)).fetchone()
    return None if row is None else row["confetti"]


def set_confetti(conn: sqlite3.Connection, year: int, month: int, count: int) -> int | None:
    """Set the confetti count (clamped >= 0). Returns the stored value, or None if uncommitted."""
    count = max(0, int(count))
    with conn:
        cur = conn.execute("UPDATE months SET confetti = ? WHERE year = ? AND month = ?", (count, year, month))
    return count if cur.rowcount else None


def get_review(conn: sqlite3.Connection, year: int, month: int) -> str | None:
    """The cached LLM review markdown, or None (uncommitted month, or never generated)."""
    row = conn.execute("SELECT ai_review FROM months WHERE year = ? AND month = ?", (year, month)).fetchone()
    return None if row is None else row["ai_review"]


def set_review(conn: sqlite3.Connection, year: int, month: int, text: str) -> None:
    """Cache the LLM review markdown for a month (spec 013)."""
    with conn:
        conn.execute("UPDATE months SET ai_review = ? WHERE year = ? AND month = ?", (text, year, month))


def load_month_images(conn: sqlite3.Connection, year: int, month: int) -> dict | None:
    """The stored source photos (data URLs) for a month, or None if the month isn't committed.
    Either value may be None when that page was never uploaded (spec 012)."""
    row = conn.execute(
        "SELECT grid_image, moments_image FROM months WHERE year = ? AND month = ?", (year, month)
    ).fetchone()
    if row is None:
        return None
    return {"grid": row["grid_image"], "moments": row["moments_image"]}


def _check_calendar(ex: Extraction) -> None:
    last = calendar.monthrange(ex.year, ex.month)[1]
    days = {c.day for c in ex.cells} | {s.day for s in ex.sleep} | {m.day for m in ex.moments}
    bad = sorted(d for d in days if d > last)
    if bad:
        raise ValueError(f"day(s) {bad} exceed {ex.year}-{ex.month:02d} length ({last})")


def _upsert_month(
    conn: sqlite3.Connection,
    ex: Extraction,
    grid_image: str | None,
    moments_image: str | None,
    notes_ocr_ok: bool,
) -> int:
    conn.execute(
        """
        INSERT INTO months(year, month, imported_at, grid_image, moments_image, notes_ocr_ok)
        VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(year, month) DO UPDATE SET
            imported_at = excluded.imported_at,
            grid_image = COALESCE(excluded.grid_image, months.grid_image),
            moments_image = COALESCE(excluded.moments_image, months.moments_image),
            notes_ocr_ok = excluded.notes_ocr_ok
        """,
        (
            ex.year,
            ex.month,
            datetime.now(timezone.utc).isoformat(),
            grid_image,
            moments_image,
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
