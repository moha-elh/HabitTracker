import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from api.main import app, get_conn, get_reader
from db import store
from pipeline.labels import StubLabelReader

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


def test_commit_persists_and_is_idempotent(client):
    r1 = client.post("/commit", json=_extraction())
    assert r1.status_code == 200 and r1.json()["entries"] == 1
    r2 = client.post("/commit", json=_extraction())  # same month again
    assert r2.status_code == 200
    assert r1.json()["month_id"] == r2.json()["month_id"]  # no duplicate month


def test_commit_calendar_invalid_is_422(client):
    # April has 30 days; day 31 passes the contract but fails commit-time validation.
    bad = _extraction(month=4, cells=[{"day": 31, "habit": "Read", "status": "done"}])
    assert client.post("/commit", json=bad).status_code == 422


def test_months_list_and_load(client):
    client.post("/commit", json=_extraction(cells=[
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
