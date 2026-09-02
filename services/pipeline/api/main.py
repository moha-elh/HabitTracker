"""FastAPI wrapper — the thin HTTP layer (CLAUDE.md §5).

Only concern in spec 001: the health-check contract. Domain routes are added in
later specs and delegate to the pure ``pipeline`` package.
"""

from __future__ import annotations

import argparse
import os

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

DEFAULT_PORT = 8756

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


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe. The frontend renders ``status`` verbatim (spec 001)."""
    return {"status": "ok"}


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
