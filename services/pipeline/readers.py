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
from pipeline.notes import MomentsReader, NullMomentsReader

_DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta/openai"
# Lite flash is fast enough on the free tier and reads handwriting well; heavier flash models
# time out on free quota. Override via LABEL_READER_MODEL.
_DEFAULT_MODEL = "gemini-flash-lite-latest"
_MAX_DIM = 1024  # downscale big photos → faster calls, smaller payload

_LABEL_PROMPT = (
    "This image is a hand-drawn monthly habit tracker. Read ALL the habit row labels "
    "(handwritten, one per row, top to bottom; some may be rotated 90°). "
    "Return ONLY a JSON array of strings, one per row in top-to-bottom order, no extra text. "
    "Include every row — the array length must equal the number of habit rows."
)

_MOMENTS_PROMPT = (
    "This image is the left page of a handwritten monthly journal: 'Memorable Moments', "
    "one short line per day, numbered or dated by day of the month. The text may mix English, "
    "French and Darija (Moroccan Arabic written in Latin letters). Read each day's line VERBATIM. "
    'Return ONLY a JSON array of objects [{"day": <1-31 integer>, "text": <string>}], in '
    "ascending day order, no extra text. Skip days with no writing."
)


def _vision_call(base_url: str, model: str, api_key: str, prompt: str, image_png: bytes, timeout: float) -> str:
    """One OpenAI-compatible vision chat call → the reply text. Retries transient 429/503."""
    b64 = base64.b64encode(_downscale_jpeg(image_png)).decode()
    payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                ],
            }
        ],
    }
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}"}
    for attempt in range(4):  # free tiers throttle: back off on 429/503
        resp = httpx.post(url, json=payload, headers=headers, timeout=timeout)
        if resp.status_code in (429, 503) and attempt < 3:
            time.sleep(2 * (attempt + 1))
            continue
        break
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


class OpenAICompatLabelReader:
    def __init__(self, base_url: str, model: str, api_key: str, timeout: float = 120.0):
        self.base_url, self.model, self.api_key, self.timeout = base_url, model, api_key, timeout

    def read(self, image_png: bytes) -> list[str]:
        return _parse_labels(_vision_call(self.base_url, self.model, self.api_key, _LABEL_PROMPT, image_png, self.timeout))


class OpenAICompatMomentsReader:
    def __init__(self, base_url: str, model: str, api_key: str, timeout: float = 120.0):
        self.base_url, self.model, self.api_key, self.timeout = base_url, model, api_key, timeout

    def read(self, image_png: bytes) -> list[dict]:
        return _parse_moments(_vision_call(self.base_url, self.model, self.api_key, _MOMENTS_PROMPT, image_png, self.timeout))


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


def _parse_moments(text: str) -> list[dict]:
    """Pull a JSON array of {day, text} out of the reply; drop malformed/blank/out-of-range.
    Tolerant: strips code fences, accepts a wrapping object, day as '12'/'12th'/'March 12',
    and text under common alternate keys."""
    m = re.search(r"\[.*\]", text, re.DOTALL)  # the array, even inside ```json fences / an object
    if not m:
        return []
    try:
        arr = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    out: list[dict] = []
    for item in arr:
        if not isinstance(item, dict):
            continue
        digits = re.search(r"\d{1,2}", str(item.get("day", "")))
        if not digits:
            continue
        day = int(digits.group(0))
        txt = str(item.get("text") or item.get("moment") or item.get("note") or item.get("line") or "").strip()
        if txt and 1 <= day <= 31:
            out.append({"day": day, "text": txt})
    return out


def _key() -> str | None:
    key = os.getenv("LABEL_READER_API_KEY") or os.getenv("GEMNINI_KEY")
    return key.strip() if key and key.strip() else None


def from_env() -> LabelReader:
    key = _key()
    if not key:
        return NullLabelReader()
    base = os.getenv("LABEL_READER_BASE_URL", _DEFAULT_BASE)
    model = os.getenv("LABEL_READER_MODEL", _DEFAULT_MODEL)
    return OpenAICompatLabelReader(base, model, key)


def moments_from_env() -> MomentsReader:
    key = _key()
    if not key:
        return NullMomentsReader()
    base = os.getenv("LABEL_READER_BASE_URL", _DEFAULT_BASE)
    model = os.getenv("MOMENTS_READER_MODEL", os.getenv("LABEL_READER_MODEL", _DEFAULT_MODEL))
    return OpenAICompatMomentsReader(base, model, key)
