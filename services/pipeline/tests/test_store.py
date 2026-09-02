import pytest

from db.store import commit_extraction, connect, migrate
from pipeline.contract import Extraction


def fresh_db():
    conn = connect(":memory:")
    migrate(conn)
    return conn


def sample(**overrides) -> Extraction:
    data = {
        "year": 2026,
        "month": 8,  # August has 31 days
        "habits": [
            {"name": "Read", "kind": "build", "sort_order": 0},
            {"name": "No sugar", "kind": "eliminate", "sort_order": 1},
        ],
        "cells": [
            {"day": 1, "habit": "Read", "status": "done"},
            {"day": 1, "habit": "No sugar", "status": "missed"},
            {"day": 2, "habit": "Read", "status": "empty"},  # → no entry row
        ],
        "sleep": [
            {"day": 1, "hours": 7.5},
            {"day": 2, "hours": None},  # → no metrics row
        ],
        "moments": [{"day": 1, "text": "Visited the mosque.", "lang": "en"}],
    }
    data.update(overrides)
    return Extraction.model_validate(data)


def count(conn, table):
    return conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]


def test_migrate_creates_schema_and_is_idempotent():
    conn = fresh_db()
    tables = {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    assert {"habits", "months", "entries", "metrics", "moments"} <= tables
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
    migrate(conn)  # no-op
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 1


def test_commit_writes_expected_rows():
    conn = fresh_db()
    rec = commit_extraction(conn, sample())
    assert count(conn, "months") == 1
    assert count(conn, "entries") == 2  # empty cell skipped
    assert count(conn, "metrics") == 1  # null sleep skipped
    assert count(conn, "moments") == 1
    assert rec.entries == 2 and rec.metrics == 1
    # done mapping: Read done=1, No sugar missed=0
    done = dict(conn.execute(
        "SELECT h.name, e.done FROM entries e JOIN habits h ON h.id = e.habit_id"
    ).fetchall())
    assert done == {"Read": 1, "No sugar": 0}


def test_reimport_is_idempotent_and_updates():
    conn = fresh_db()
    commit_extraction(conn, sample())
    commit_extraction(conn, sample())  # same month again
    assert count(conn, "months") == 1
    assert count(conn, "entries") == 2  # no duplicates

    # flip day-1 Read to missed and re-commit
    updated = sample(cells=[{"day": 1, "habit": "Read", "status": "missed"}])
    commit_extraction(conn, updated)
    assert count(conn, "entries") == 1  # dropped stale rows (day1 No sugar, day2 empty gone)
    row = conn.execute(
        "SELECT e.done FROM entries e JOIN habits h ON h.id = e.habit_id WHERE h.name='Read'"
    ).fetchone()
    assert row["done"] == 0


def test_calendar_validity_rejected():
    conn = fresh_db()
    # April (month 4) has 30 days; day 31 is invalid.
    bad = sample(month=4, cells=[{"day": 31, "habit": "Read", "status": "done"}])
    with pytest.raises(ValueError):
        commit_extraction(conn, bad)
    assert count(conn, "months") == 0  # transaction rolled back / never entered
