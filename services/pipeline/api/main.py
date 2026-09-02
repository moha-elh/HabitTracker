"""FastAPI wrapper — the thin HTTP layer (CLAUDE.md §5).

Serves the health probe (spec 001) and the extract/commit routes (spec 005). Routes only
compose: build the LabelReader, open the DB, and delegate to the pure ``pipeline`` package.
"""

from __future__ import annotations

import argparse
import base64
import logging
import os
from calendar import monthrange

import uvicorn
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from db import store
from pipeline.contract import Extraction
from pipeline.grid import GridConfig, GridNotFound, extract
from pipeline.labels import LabelReader
from pipeline.notes import MomentsReader
from readers import from_env, moments_from_env

load_dotenv()  # makes GEMNINI_KEY / LABEL_READER_* available to the reader

DEFAULT_PORT = 8756
DB_PATH = os.environ.get("HC_DB_PATH", "habit.db")

app = FastAPI(title="Habit Chronicle sidecar", version="0.1.0")

# Dev-only: the Tauri webview and the Vite dev server call us cross-origin.
# Loopback-bound, single-user, local tool — allow-all is acceptable here and
# tightened if the sidecar ever binds beyond 127.0.0.1.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- injectable composition (overridden in tests: stub reader + in-memory DB) ---
_conn = None


def get_conn():
    global _conn
    if _conn is None:
        _conn = store.connect(DB_PATH)
        store.migrate(_conn)
    return _conn


def get_reader() -> LabelReader:
    return from_env()


def get_moments_reader() -> MomentsReader:
    return moments_from_env()


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe. The frontend renders ``status`` verbatim (spec 001)."""
    return {"status": "ok"}


@app.post("/extract")
def extract_route(
    year: int = Form(...),
    month: int = Form(...),
    image: UploadFile = File(...),
    days: int | None = Form(None),  # grid column count; defaults to the month's length
    flip_habits: bool = Form(False),  # reverse habit-row order (rotated photos read inverted)
    moments_image: UploadFile | None = File(None),  # optional left-page "memorable moments"
    reader: LabelReader = Depends(get_reader),
    moments_reader: MomentsReader = Depends(get_moments_reader),
) -> dict:
    """Grid photo (+ optional moments photo) → draft Extraction + the reference grid image."""
    cols = days or monthrange(year, month)[1]
    try:
        result = extract(
            image.file.read(),
            GridConfig(year=year, month=month, days=cols, flip_habits=flip_habits),
            reader,
        )
    except GridNotFound as e:
        raise HTTPException(status_code=422, detail=str(e))

    ex = result.extraction
    moments_status = "no image"
    if moments_image is not None:
        last = monthrange(year, month)[1]
        seen: set[int] = set()
        moments: list[dict] = []
        try:
            for m in moments_reader.read(moments_image.file.read()):
                day = m["day"]
                if day in seen or day > last:  # dedupe + drop out-of-month so /commit won't reject
                    continue
                seen.add(day)
                moments.append({"day": day, "text": m["text"]})
            moments_status = f"read {len(moments)}" if moments else "no moments read"
        except Exception as e:  # a reader/LLM failure must not lose the grid extract
            logging.getLogger("hc.extract").warning("moments read failed: %s", e)
            moments_status = f"error: {e}"
        if moments:  # re-validate through the contract (uniqueness, non-blank text)
            ex = Extraction.model_validate({**ex.model_dump(), "moments": moments})

    return {
        "extraction": ex.model_dump(mode="json"),
        "rows": result.rows,
        "moments_status": moments_status,
        "rectified_png_b64": base64.b64encode(result.rectified_png).decode(),
        "reference_png_b64": base64.b64encode(result.reference_png).decode(),
    }


@app.get("/months")
def months_route(conn=Depends(get_conn)) -> list[dict]:
    """List committed months for the dashboard selector (spec 007)."""
    return store.list_months(conn)


@app.get("/months/{year}/{month}")
def month_route(year: int, month: int, conn=Depends(get_conn)) -> dict:
    """Full month payload for the dashboard, or 404 if not committed (spec 007)."""
    data = store.load_month(conn, year, month)
    if data is None:
        raise HTTPException(status_code=404, detail="month not committed")
    return data


@app.post("/commit")
def commit_route(extraction: Extraction, conn=Depends(get_conn)) -> dict:
    """Persist a (reviewed) Extraction. Idempotent on (year, month) — spec 003."""
    try:
        rec = store.commit_extraction(conn, extraction)
    except ValueError as e:  # calendar validity etc.
        raise HTTPException(status_code=422, detail=str(e))
    return {
        "month_id": rec.month_id,
        "year": rec.year,
        "month": rec.month,
        "entries": rec.entries,
        "metrics": rec.metrics,
        "moments": rec.moments,
    }


def _resolve_port() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=None)
    args, _ = parser.parse_known_args()
    if args.port is not None:
        return args.port
    return int(os.environ.get("HC_SIDECAR_PORT", DEFAULT_PORT))


def main() -> None:
    uvicorn.run(app, host="127.0.0.1", port=_resolve_port())


if __name__ == "__main__":
    main()
