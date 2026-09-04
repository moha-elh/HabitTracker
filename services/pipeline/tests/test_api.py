import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from api.main import app, get_conn, get_moments_reader, get_reader, get_reviewer, get_sleep_reader
from db import store
from pipeline.labels import StubLabelReader
from pipeline.notes import NullMomentsReader, StubMomentsReader
from pipeline.sleep import NullSleepReader, StubSleepReader

ROWS, COLS, CELL = 6, 31, 16


def _synthetic_png() -> bytes:
    img = np.full((ROWS * CELL, COLS * CELL, 3), 255, np.uint8)
    for r in range(ROWS):
        for c in range(COLS):
            color = (0, 180, 0) if (r + c) % 2 == 0 else (0, 0, 200)
            cv2.rectangle(img, (c * CELL, r * CELL), ((c + 1) * CELL - 1, (r + 1) * CELL - 1), color, -1)
    return cv2.imencode(".png", img)[1].tobytes()


@pytest.fixture
def client():
    conn = store.connect(":memory:")
    store.migrate(conn)
    app.dependency_overrides[get_conn] = lambda: conn
    app.dependency_overrides[get_reader] = lambda: StubLabelReader([f"H{i}" for i in range(ROWS)])
    # Moments/sleep readers now run on every extract — stub them offline (Null) by default so
    # tests never touch the network; individual tests override with a Stub.
    app.dependency_overrides[get_moments_reader] = lambda: NullMomentsReader()
    app.dependency_overrides[get_sleep_reader] = lambda: NullSleepReader()
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_extract_returns_draft(client):
    r = client.post(
        "/extract",
        data={"year": 2026, "month": 8},
        files={"image": ("g.png", _synthetic_png(), "image/png")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["rows"] == ROWS
    assert body["rectified_png_b64"]
    assert body["extraction"]["month"] == 8
    assert len(body["extraction"]["habits"]) == ROWS


def test_extract_blank_is_422(client):
    blank = cv2.imencode(".png", np.full((200, 200, 3), 255, np.uint8))[1].tobytes()
    r = client.post(
        "/extract",
        data={"year": 2026, "month": 8},
        files={"image": ("b.png", blank, "image/png")},
    )
    assert r.status_code == 422


def _extraction(**over):
    d = {
        "year": 2026, "month": 8,
        "habits": [{"name": "Read", "sort_order": 0}],
        "cells": [{"day": 1, "habit": "Read", "status": "done"}],
    }
    d.update(over)
    return d


def _commit(**over):
    """Wrap an extraction dict in the CommitRequest body shape."""
    return {"extraction": _extraction(**over)}


def test_commit_persists_and_is_idempotent(client):
    r1 = client.post("/commit", json=_commit())
    assert r1.status_code == 200 and r1.json()["entries"] == 1
    r2 = client.post("/commit", json=_commit())  # same month again
    assert r2.status_code == 200
    assert r1.json()["month_id"] == r2.json()["month_id"]  # no duplicate month


def test_commit_calendar_invalid_is_422(client):
    # April has 30 days; day 31 passes the contract but fails commit-time validation.
    bad = _commit(month=4, cells=[{"day": 31, "habit": "Read", "status": "done"}])
    assert client.post("/commit", json=bad).status_code == 422


def test_commit_stores_and_serves_source_images(client):
    grid = "data:image/png;base64,GRID"
    client.post("/commit", json={**_commit(), "grid_image": grid})
    imgs = client.get("/months/2026/8/images").json()
    assert imgs == {"grid": grid, "moments": None}
    # Re-commit without images preserves the stored one (COALESCE).
    client.post("/commit", json=_commit())
    assert client.get("/months/2026/8/images").json()["grid"] == grid
    assert client.get("/months/2099/1/images").status_code == 404


def test_months_list_and_load(client):
    client.post("/commit", json=_commit(cells=[
        {"day": 1, "habit": "Read", "status": "done"},
        {"day": 2, "habit": "Read", "status": "missed"},
    ]))
    months = client.get("/months").json()
    assert months and months[0]["year"] == 2026 and months[0]["month"] == 8
    assert months[0]["entries"] == 2

    data = client.get("/months/2026/8").json()
    assert data["days"] == 31
    assert [h["name"] for h in data["habits"]] == ["Read"]
    got = {(e["day"], e["done"]) for e in data["entries"]}
    assert got == {(1, 1), (2, 0)}


def test_load_uncommitted_month_is_404(client):
    assert client.get("/months/2099/1").status_code == 404


def test_delete_month_removes_it_and_keeps_habits(client):
    client.post("/commit", json=_commit(cells=[{"day": 1, "habit": "Read", "status": "done"}]))
    assert client.get("/months/2026/8").status_code == 200
    r = client.delete("/months/2026/8")
    assert r.status_code == 200 and r.json() == {"deleted": True}
    assert client.get("/months/2026/8").status_code == 404  # gone
    assert client.get("/months").json() == []  # not listed
    # the shared habit row is untouched, so re-committing the month works
    assert client.post("/commit", json=_commit()).status_code == 200


def test_delete_uncommitted_month_is_404(client):
    assert client.delete("/months/2099/1").status_code == 404


class _StubReviewer:
    """Echoes the summary back so the test asserts the summary reached the reviewer."""

    def review(self, summary: str) -> str:
        return "**How the month went**: " + summary


def test_month_review_runs_reviewer_over_summary(client):
    app.dependency_overrides[get_reviewer] = lambda: _StubReviewer()
    client.post("/commit", json=_commit(cells=[
        {"day": 1, "habit": "Read", "status": "done"},
        {"day": 2, "habit": "Read", "status": "missed"},
    ]))
    r = client.get("/months/2026/8/review")
    assert r.status_code == 200
    text = r.json()["review"]
    assert "Overall completion: 50%" in text  # summary built from the committed data


def test_month_review_404_when_uncommitted(client):
    app.dependency_overrides[get_reviewer] = lambda: _StubReviewer()
    assert client.get("/months/2099/1/review").status_code == 404


def test_month_review_503_without_key(client):
    app.dependency_overrides[get_reviewer] = lambda: None  # no API key configured
    client.post("/commit", json=_commit())
    assert client.get("/months/2026/8/review").status_code == 503


class _CountingReviewer:
    def __init__(self):
        self.calls = 0

    def review(self, summary: str) -> str:
        self.calls += 1
        return f"opener {self.calls}"

    def review_overall(self, summary: str) -> str:
        self.calls += 1
        return f"overall {self.calls}"


def test_review_is_cached_and_only_regenerated_on_refresh(client):
    rev = _CountingReviewer()
    app.dependency_overrides[get_reviewer] = lambda: rev
    client.post("/commit", json=_commit())
    assert client.get("/months/2026/8/review").json() == {"review": "opener 1", "cached": False}
    assert client.get("/months/2026/8/review").json() == {"review": "opener 1", "cached": True}
    assert rev.calls == 1  # second call served from the DB cache
    refreshed = client.get("/months/2026/8/review?refresh=true").json()
    assert refreshed == {"review": "opener 2", "cached": False} and rev.calls == 2


def test_cached_review_served_even_without_key(client):
    app.dependency_overrides[get_reviewer] = lambda: _StubReviewer()
    client.post("/commit", json=_commit())
    client.get("/months/2026/8/review")  # generate + cache
    app.dependency_overrides[get_reviewer] = lambda: None  # key later removed
    r = client.get("/months/2026/8/review")
    assert r.status_code == 200 and r.json()["cached"] is True


def test_overall_review_caches_until_months_change(client):
    rev = _CountingReviewer()
    app.dependency_overrides[get_reviewer] = lambda: rev
    assert client.get("/review/overall").status_code == 404  # nothing committed yet

    client.post("/commit", json=_commit(year=2026, month=8))
    r = client.get("/review/overall").json()
    assert r == {"review": "overall 1", "cached": False, "months": 1, "stale": False}
    assert client.get("/review/overall").json()["cached"] is True  # served from cache
    assert rev.calls == 1

    # Adding a month changes the signature → a new call.
    client.post("/commit", json=_commit(year=2026, month=9))
    r2 = client.get("/review/overall").json()
    assert r2 == {"review": "overall 2", "cached": False, "months": 2, "stale": False}
    assert rev.calls == 2
    assert client.get("/review/overall").json()["cached"] is True  # cached again for the new set


def test_overall_review_only_cached_never_generates(client):
    rev = _CountingReviewer()
    app.dependency_overrides[get_reviewer] = lambda: rev
    client.post("/commit", json=_commit(year=2026, month=8))
    # Page-load probe with nothing cached: 404, and NO AI call.
    assert client.get("/review/overall?only_cached=true").status_code == 404
    assert rev.calls == 0
    # After a real generate, the probe serves the cache without generating again.
    assert client.get("/review/overall").json()["cached"] is False
    assert client.get("/review/overall?only_cached=true").json() == {"review": "overall 1", "cached": True, "months": 1, "stale": False}
    assert rev.calls == 1
    # Months change → probe still won't generate; serves the old one flagged stale.
    client.post("/commit", json=_commit(year=2026, month=9))
    r = client.get("/review/overall?only_cached=true").json()
    assert r["stale"] is True and r["cached"] is True and rev.calls == 1


def test_overall_review_regenerates_when_a_month_is_re_imported(client):
    rev = _CountingReviewer()
    app.dependency_overrides[get_reviewer] = lambda: rev
    client.post("/commit", json=_commit(cells=[{"day": 1, "habit": "Read", "status": "done"}]))
    client.get("/review/overall")  # cache with 1 entry
    # Re-import the same month with an extra marked cell → entry count changes → regenerate.
    client.post("/commit", json=_commit(cells=[
        {"day": 1, "habit": "Read", "status": "done"},
        {"day": 2, "habit": "Read", "status": "missed"},
    ]))
    assert client.get("/review/overall").json()["cached"] is False
    assert rev.calls == 2


def test_overall_review_served_stale_without_key(client):
    rev = _CountingReviewer()
    app.dependency_overrides[get_reviewer] = lambda: rev
    client.post("/commit", json=_commit(year=2026, month=8))
    client.get("/review/overall")  # generate + cache
    client.post("/commit", json=_commit(year=2026, month=9))  # months changed
    app.dependency_overrides[get_reviewer] = lambda: None  # key removed before regenerating
    r = client.get("/review/overall").json()
    assert r["review"] == "overall 1" and r["cached"] is True and r["stale"] is True


def test_concurrent_month_loads_never_404(tmp_path, monkeypatch):
    """Trends fires GET /months/{y}/{m} for every month at once (Promise.all). With a single
    shared sqlite connection that raced and returned spurious 'month not committed' 404s. Use the
    REAL get_conn (per-request connection) over a temp-file DB and hammer it concurrently."""
    import concurrent.futures as cf

    import api.main as main

    db = tmp_path / "concurrency.db"
    monkeypatch.setattr(main, "DB_PATH", str(db))
    monkeypatch.setattr(main, "_migrated", False)
    main.app.dependency_overrides.pop(get_conn, None)  # exercise the real per-request conn
    main.app.dependency_overrides[get_reader] = lambda: StubLabelReader([f"H{i}" for i in range(ROWS)])
    main.app.dependency_overrides[get_moments_reader] = lambda: NullMomentsReader()
    main.app.dependency_overrides[get_sleep_reader] = lambda: NullSleepReader()
    try:
        c = TestClient(main.app)
        months = list(range(1, 11))
        for m in months:
            c.post("/commit", json=_commit(month=m, cells=[{"day": 1, "habit": "Read", "status": "done"}]))
        with cf.ThreadPoolExecutor(max_workers=10) as ex:
            codes = list(ex.map(lambda m: c.get(f"/months/2026/{m}").status_code, months * 5))
        assert set(codes) == {200}, f"got non-200s: {sorted(set(codes))}"
    finally:
        main.app.dependency_overrides.clear()


def test_confetti_roundtrip_and_persists(client):
    client.post("/commit", json=_commit())
    assert client.get("/months/2026/8/confetti").json() == {"count": 0}
    assert client.put("/months/2026/8/confetti", json={"count": 7}).json() == {"count": 7}
    assert client.get("/months/2026/8/confetti").json() == {"count": 7}
    assert client.get("/months/2026/8").json()["confetti"] == 7  # also on the month payload


def test_confetti_uncommitted_is_404(client):
    assert client.get("/months/2099/1/confetti").status_code == 404
    assert client.put("/months/2099/1/confetti", json={"count": 3}).status_code == 404


def test_extract_with_moments_image(client):
    # April has 30 days; day 99 must be dropped, day 12 kept.
    app.dependency_overrides[get_moments_reader] = lambda: StubMomentsReader(
        [{"day": 12, "text": "Visited the mosque."}, {"day": 99, "text": "impossible day"}]
    )
    r = client.post(
        "/extract",
        data={"year": 2026, "month": 4},
        files={
            "image": ("g.png", _synthetic_png(), "image/png"),
            "moments_image": ("m.png", _synthetic_png(), "image/png"),
        },
    )
    assert r.status_code == 200
    moments = r.json()["extraction"]["moments"]
    assert moments == [{"day": 12, "weekday": None, "text": "Visited the mosque.", "lang": None}]


def test_extract_without_moments_image_has_none(client):
    r = client.post(
        "/extract",
        data={"year": 2026, "month": 8},
        files={"image": ("g.png", _synthetic_png(), "image/png")},
    )
    assert r.status_code == 200
    assert r.json()["extraction"]["moments"] == []
    assert r.json()["extraction"]["sleep"] == []


def test_extract_reads_sleep_from_grid_image(client):
    # Sleep is read from the SAME grid image (no separate upload). April has 30 days;
    # day 40 dropped (past month), the second day 3 deduped.
    app.dependency_overrides[get_sleep_reader] = lambda: StubSleepReader(
        [{"day": 3, "hours": 6.5}, {"day": 40, "hours": 7}, {"day": 3, "hours": 8.0}]
    )
    r = client.post(
        "/extract",
        data={"year": 2026, "month": 4},
        files={"image": ("g.png", _synthetic_png(), "image/png")},
    )
    assert r.status_code == 200
    sleep = r.json()["extraction"]["sleep"]
    assert [(s["day"], s["hours"]) for s in sleep] == [(3, 6.5)]
    assert r.json()["sleep_status"] == "read 1"
