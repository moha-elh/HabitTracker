"""FastAPI wrapper — the thin HTTP layer (CLAUDE.md §5).

Serves the health probe (spec 001) and the extract/commit routes (spec 005). Routes only
compose: build the LabelReader, open the DB, and delegate to the pure ``pipeline`` package.
"""

from __future__ import annotations

import argparse
import base64
import calendar
import logging
import os
from calendar import monthrange
from collections import defaultdict

import uvicorn
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from db import store
from pipeline.contract import Extraction
from pipeline.grid import GridConfig, GridNotFound, extract
from pipeline.labels import LabelReader
from pipeline.notes import MomentsReader
from pipeline.sleep import SleepReader
from readers import from_env, moments_from_env, review_from_env, sleep_from_env

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


def get_sleep_reader() -> SleepReader:
    return sleep_from_env()


def get_reviewer():
    return review_from_env()


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    """Pearson correlation, or None if fewer than 3 points or no variance."""
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx == 0 or syy == 0:
        return None
    return sxy / (sxx**0.5 * syy**0.5)


def _month_summary(data: dict) -> str:
    """Compact, number-rich text summary of a committed month for the LLM reviewer (spec 013).
    Includes the paired sleep/productivity series, their correlation, and weekday averages so the
    model can give data-grounded insights rather than generic advice."""
    y, m, days = data["year"], data["month"], data["days"]
    habits = [h["name"] for h in data["habits"]]
    done_by: dict[str, list[int]] = defaultdict(lambda: [0, 0])  # name -> [done, tracked]
    day_done: dict[int, int] = defaultdict(int)
    habit_days: dict[str, dict[str, list[int]]] = defaultdict(lambda: {"done": [], "missed": []})
    for e in data["entries"]:
        done_by[e["habit"]][1] += 1
        habit_days[e["habit"]]["done" if e["done"] else "missed"].append(e["day"])
        if e["done"]:
            done_by[e["habit"]][0] += 1
            day_done[e["day"]] += 1
    total_tracked = sum(v[1] for v in done_by.values())
    total_done = sum(v[0] for v in done_by.values())
    sleep_by_day = {s["day"]: s["hours"] for s in data["sleep"]}

    lines = [f"Month: {calendar.month_name[m]} {y} ({days} days), {len(habits)} habits tracked."]
    if total_tracked:
        lines.append(f"Overall completion: {round(100 * total_done / total_tracked)}% ({total_done} of {total_tracked} tracked cells done).")
    per = sorted(((round(100 * done_by[n][0] / done_by[n][1]) if done_by[n][1] else 0, n) for n in habits), reverse=True)
    if per:
        lines.append("Per-habit completion, best to worst: " + "; ".join(f"{n} {p}%" for p, n in per) + ".")

    sleep = list(sleep_by_day.values())
    if sleep:
        lines.append(f"Sleep: {len(sleep)} nights logged, mean {round(sum(sleep) / len(sleep), 1)}h, shortest {min(sleep)}h, longest {max(sleep)}h.")
    else:
        lines.append("Sleep: no nights logged.")

    # Paired sleep vs habits-done, day by day, plus their correlation (the key insight signal).
    paired = sorted((d, day_done.get(d, 0), sleep_by_day[d]) for d in sleep_by_day)
    if paired:
        r = _pearson([h for _, h, _ in paired], [hrs for _, _, hrs in paired])
        if r is not None:
            lines.append(f"Sleep-vs-productivity correlation (Pearson r over {len(paired)} paired days): {round(r, 2)} (positive = more sleep, more habits done).")
        lines.append("Per-day (day: habits done / sleep h): " + "; ".join(f"{d}:{h}/{hrs}" for d, h, hrs in paired) + ".")

    # Average habits done per weekday, to expose weekly rhythm / where things slip.
    wk_tot: dict[int, int] = defaultdict(int)
    wk_cnt: dict[int, int] = defaultdict(int)
    for d in range(1, days + 1):
        wd = calendar.weekday(y, m, d)  # Mon=0..Sun=6
        wk_tot[wd] += day_done.get(d, 0)
        wk_cnt[wd] += 1
    wk_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    lines.append("Average habits done by weekday: " + ", ".join(f"{wk_names[wd]} {round(wk_tot[wd] / wk_cnt[wd], 1)}" for wd in range(7) if wk_cnt[wd]) + ".")

    # Momentum: did the month build or fade? Compare habits done in each half.
    half = days // 2
    fh = sum(day_done.get(d, 0) for d in range(1, half + 1))
    sh = sum(day_done.get(d, 0) for d in range(half + 1, days + 1))
    lines.append(f"Momentum: {fh} habits done in the first half of the month vs {sh} in the second half.")

    # Keystone lift: on days a habit is KEPT, how many OTHER habits get done vs on days it is
    # skipped? A big positive lift flags a habit worth protecting (its presence coincides with a
    # more productive day, beyond its own +1). Only habits with >=2 kept and >=2 skipped days.
    def _avg(xs: list[float]) -> float:
        return sum(xs) / len(xs) if xs else 0.0

    lifts = []
    for name in habits:
        dd, mm = habit_days[name]["done"], habit_days[name]["missed"]
        if len(dd) >= 2 and len(mm) >= 2:
            aw = _avg([day_done.get(d, 0) - 1 for d in dd])  # exclude this habit's own contribution
            an = _avg([day_done.get(d, 0) for d in mm])
            lifts.append((round(aw - an, 1), name, round(aw, 1), round(an, 1)))
    lifts.sort(reverse=True)
    top = [x for x in lifts if x[0] > 0][:3]
    if top:
        lines.append(
            "Keystone lift (other habits done on days this one is KEPT vs SKIPPED): "
            + "; ".join(f"{n} +{lift} ({aw} vs {an})" for lift, n, aw, an in top) + "."
        )

    if day_done:
        best = max(day_done, key=lambda d: day_done[d])
        lines.append(f"Strongest day: day {best} with {day_done[best]} habits done.")
    return "\n".join(lines)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe. The frontend renders ``status`` verbatim (spec 001)."""
    return {"status": "ok"}


def _read_page(reader, image_bytes: bytes | None, last_day: int) -> tuple[list[dict], str]:
    """Run a page reader over image bytes; dedupe by day, drop days past the month, never raise.
    Returns (items, status) where status is 'no image' / 'read N' / 'nothing read' / 'error: …'."""
    if image_bytes is None:
        return [], "no image"
    try:
        seen: set[int] = set()
        items: list[dict] = []
        for m in reader.read(image_bytes):
            day = m["day"]
            if day in seen or day > last_day:
                continue
            seen.add(day)
            items.append(m)
        return items, (f"read {len(items)}" if items else "nothing read")
    except Exception as e:  # a reader/LLM failure must not lose the grid extract
        logging.getLogger("hc.extract").warning("page read failed: %s", e)
        return [], f"error: {e}"


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
    sleep_reader: SleepReader = Depends(get_sleep_reader),
) -> dict:
    """Grid photo (+ optional moments photo) → draft Extraction + reference image. Sleep is read
    from the SAME grid image (its line chart sits beside the grid)."""
    cols = days or monthrange(year, month)[1]
    last = monthrange(year, month)[1]
    image_bytes = image.file.read()
    try:
        result = extract(
            image_bytes,
            GridConfig(year=year, month=month, days=cols, flip_habits=flip_habits),
            reader,
        )
    except GridNotFound as e:
        raise HTTPException(status_code=422, detail=str(e))

    ex = result.extraction
    moments, moments_status = _read_page(moments_reader, moments_image.file.read() if moments_image else None, last)
    sleep, sleep_status = _read_page(sleep_reader, image_bytes, last)  # sleep chart is in the grid image
    update: dict = {}
    if moments:
        update["moments"] = [{"day": m["day"], "text": m["text"]} for m in moments]
    if sleep:
        update["sleep"] = [{"day": s["day"], "hours": s["hours"]} for s in sleep]
    if update:  # re-validate through the contract (uniqueness, ranges, non-blank text)
        ex = Extraction.model_validate({**ex.model_dump(), **update})

    return {
        "extraction": ex.model_dump(mode="json"),
        "rows": result.rows,
        "moments_status": moments_status,
        "sleep_status": sleep_status,
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


@app.get("/months/{year}/{month}/images")
def month_images_route(year: int, month: int, conn=Depends(get_conn)) -> dict:
    """Stored source photos (data URLs) for a month, or 404 if not committed (spec 012).
    Kept off the main month payload so the dashboard only fetches them when opening the popup."""
    imgs = store.load_month_images(conn, year, month)
    if imgs is None:
        raise HTTPException(status_code=404, detail="month not committed")
    return imgs


@app.get("/months/{year}/{month}/review")
def month_review_route(year: int, month: int, refresh: bool = False, conn=Depends(get_conn), reviewer=Depends(get_reviewer)) -> dict:
    """LLM review + lifestyle advice for a committed month (spec 013). Cached in the DB after the
    first generation; ``refresh=true`` forces a regenerate. 404 if uncommitted, 503 if no API key.
    Data never leaves the machine except to the configured LLM."""
    data = store.load_month(conn, year, month)
    if data is None:
        raise HTTPException(status_code=404, detail="month not committed")
    if not refresh and data.get("review"):
        return {"review": data["review"], "cached": True}
    if reviewer is None:
        raise HTTPException(status_code=503, detail="No AI key configured. Add GEMNINI_KEY to .env to enable monthly reviews.")
    try:
        review = reviewer.review(_month_summary(data))
    except Exception as e:  # LLM/network failure
        raise HTTPException(status_code=502, detail=f"review failed: {e}")
    store.set_review(conn, year, month, review)
    return {"review": review, "cached": False}


class ConfettiRequest(BaseModel):
    count: int


@app.get("/months/{year}/{month}/confetti")
def get_confetti_route(year: int, month: int, conn=Depends(get_conn)) -> dict:
    """The stored confetti count for a month (spec 013). 404 if uncommitted."""
    count = store.get_confetti(conn, year, month)
    if count is None:
        raise HTTPException(status_code=404, detail="month not committed")
    return {"count": count}


@app.put("/months/{year}/{month}/confetti")
def set_confetti_route(year: int, month: int, body: ConfettiRequest, conn=Depends(get_conn)) -> dict:
    """Persist the confetti count (absolute; the frontend debounces clicks). 404 if uncommitted."""
    count = store.set_confetti(conn, year, month, body.count)
    if count is None:
        raise HTTPException(status_code=404, detail="month not committed")
    return {"count": count}


class CommitRequest(BaseModel):
    """A reviewed extraction plus the source photos to archive (spec 012)."""

    extraction: Extraction
    grid_image: str | None = None  # data URL of the grid reference shown in review
    moments_image: str | None = None  # data URL of the uploaded moments page


@app.post("/commit")
def commit_route(body: CommitRequest, conn=Depends(get_conn)) -> dict:
    """Persist a (reviewed) Extraction. Idempotent on (year, month), spec 003."""
    try:
        rec = store.commit_extraction(
            conn, body.extraction, grid_image=body.grid_image, moments_image=body.moments_image
        )
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
