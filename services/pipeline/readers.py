"""Provider-agnostic habit-label reader (network egress — kept OUT of the pure pipeline/).

Talks to any OpenAI-compatible chat endpoint (Gemini, Groq, OpenRouter, Ollama, Together…),
so switching free providers is an env change, not a code change (CLAUDE.md §10 swappable
interface). Defaults target Gemini's OpenAI-compatible endpoint.

Env:
  LABEL_READER_BASE_URL  (default: Gemini OpenAI-compat endpoint)
  LABEL_READER_MODEL     (default: gemini-2.0-flash)
  LABEL_READER_API_KEY   (fallback: GEMNINI_KEY from .env)
No key → NullLabelReader (blank labels, typed in review). Key never leaves this process except
to the configured provider.
"""

from __future__ import annotations

import base64
import json
import os
import re
import time

import cv2
import httpx
import numpy as np

from pipeline.labels import LabelReader, NullLabelReader

_DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta/openai"
# Lite flash is fast enough on the free tier and reads handwriting well; heavier flash models
# time out on free quota. Override via LABEL_READER_MODEL.
_DEFAULT_MODEL = "gemini-flash-lite-latest"
_MAX_DIM = 1024  # downscale big photos → faster calls, smaller payload

_PROMPT = (
    "This image is a hand-drawn monthly habit tracker. Read ALL the habit row labels "
    "(handwritten, one per row, top to bottom; some may be rotated 90°). "
    "Return ONLY a JSON array of strings, one per row in top-to-bottom order, no extra text. "
    "Include every row — the array length must equal the number of habit rows."
)


class OpenAICompatLabelReader:
    def __init__(self, base_url: str, model: str, api_key: str, timeout: float = 120.0):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.timeout = timeout

    def read(self, image_png: bytes) -> list[str]:
        b64 = base64.b64encode(_downscale_jpeg(image_png)).decode()
        payload = {
            "model": self.model,
            "temperature": 0,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": _PROMPT},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    ],
                }
            ],
        }
        url = f"{self.base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        # Free tiers throttle: retry transient 429/503 with backoff.
        for attempt in range(4):
            resp = httpx.post(url, json=payload, headers=headers, timeout=self.timeout)
            if resp.status_code in (429, 503) and attempt < 3:
                time.sleep(2 * (attempt + 1))
                continue
            break
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        return _parse_labels(content)


def _downscale_jpeg(raw: bytes, max_dim: int = _MAX_DIM) -> bytes:
    """Shrink to <= max_dim on the long side and JPEG-encode. Falls back to raw on decode fail."""
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return raw
    h, w = img.shape[:2]
    if max(h, w) > max_dim:
        s = max_dim / max(h, w)
        img = cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return jpg.tobytes() if ok else raw


def _parse_labels(text: str) -> list[str]:
    """Pull a JSON string array out of the model reply, tolerating code fences / prose."""
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if m:
        try:
            arr = json.loads(m.group(0))
            return [str(x).strip() for x in arr]
        except json.JSONDecodeError:
            pass
    # fallback: non-empty lines
    return [ln.strip(" -*\t") for ln in text.splitlines() if ln.strip()]


def from_env() -> LabelReader:
    key = os.getenv("LABEL_READER_API_KEY") or os.getenv("GEMNINI_KEY")
    if not key or not key.strip():
        return NullLabelReader()
    base = os.getenv("LABEL_READER_BASE_URL", _DEFAULT_BASE)
    model = os.getenv("LABEL_READER_MODEL", _DEFAULT_MODEL)
    return OpenAICompatLabelReader(base, model, key.strip())
