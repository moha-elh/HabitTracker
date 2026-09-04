"""Provider-agnostic habit-label reader (network egress — kept OUT of the pure pipeline/).

Talks to any OpenAI-compatible chat endpoint (Gemini, Groq, OpenRouter, Ollama, Together…),
so switching free providers is an env change, not a code change (CLAUDE.md §10 swappable
interface). Defaults target Gemini's OpenAI-compatible endpoint.

Providers form an ordered failover chain built from whichever keys are in .env — Google
(GEMNINI_KEY) first, then Groq (GROQ_KEY), then Nvidia (NVIDIA_KEY). A call falls through to the
next provider on any HTTP/network error (overload, quota, outage). See _PROVIDER_SPECS.

Env:
  GEMNINI_KEY / GROQ_KEY / NVIDIA_KEY   provider keys; each present one joins the chain in order
  LABEL_READER_API_KEY (+ _BASE_URL / _MODEL)  override: use a single custom provider instead
No key → NullLabelReader (blank labels, typed in review). Keys never leave this process except to
the provider being called.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import time
from dataclasses import dataclass

import cv2
import httpx
import numpy as np

from pipeline.labels import LabelReader, NullLabelReader
from pipeline.notes import MomentsReader, NullMomentsReader
from pipeline.sleep import NullSleepReader, SleepReader

_log = logging.getLogger("hc.readers")

_DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta/openai"
# Lite flash is fast enough on the free tier and reads handwriting well; heavier flash models
# time out on free quota. Override via LABEL_READER_MODEL.
_DEFAULT_MODEL = "gemini-flash-lite-latest"
_MAX_DIM = 1024  # downscale big photos → faster calls, smaller payload


@dataclass(frozen=True)
class ProviderCfg:
    """One OpenAI-compatible provider: where to call it and which vision/text model to use.
    vision_model is None for a text-only provider (skipped in the vision failover chain)."""
    name: str
    base_url: str
    api_key: str
    vision_model: str | None
    text_model: str


# Ordered failover chain (spec: Google first, then Groq, then Nvidia). A provider joins the chain
# only when its key is in .env; a call falls through to the next provider on any HTTP/network error
# (overload, quota, outage). base_url + models are each provider's OpenAI-compatible endpoints.
# Groq exposes no vision model on the free tier (text-only here), so it sits out the vision chain.
# Nvidia's 11b vision is fast and reliable; the 90b variant times out on big grids.
_PROVIDER_SPECS: list[tuple[str, str, str, str | None, str]] = [
    ("google", _DEFAULT_BASE, "GEMNINI_KEY", _DEFAULT_MODEL, _DEFAULT_MODEL),
    ("groq", "https://api.groq.com/openai/v1", "GROQ_KEY",
     None, "openai/gpt-oss-120b"),
    ("nvidia", "https://integrate.api.nvidia.com/v1", "NVIDIA_KEY",
     "meta/llama-3.2-11b-vision-instruct", "meta/llama-3.3-70b-instruct"),
]

_LABEL_PROMPT = (
    "This image is a hand-drawn monthly habit tracker. Read ALL the habit row labels "
    "(handwritten, one per row, top to bottom; some may be rotated 90°). "
    "Return ONLY a JSON array of strings, one per row in top-to-bottom order, no extra text. "
    "Include every row: the array length must equal the number of habit rows."
)

_MOMENTS_PROMPT = (
    "This image is the left page of a handwritten monthly journal: 'Memorable Moments', "
    "one short line per day, numbered or dated by day of the month. The text may mix English, "
    "French and Darija (Moroccan Arabic written in Latin letters). Read each day's line VERBATIM. "
    'Return ONLY a JSON array of objects [{"day": <1-31 integer>, "text": <string>}], in '
    "ascending day order, no extra text. Skip days with no writing."
)

_SLEEP_PROMPT = (
    "This image shows a hand-drawn chart for one month, drawn SIDEWAYS (transposed). Read the BLUE "
    "line labelled 'sleep' (NOT the red 'total of habits' line).\n"
    "AXES (read carefully, this is not a normal chart):\n"
    "- The HORIZONTAL axis runs along the TOP and is HOURS SLEPT: a numbered scale increasing left "
    "to right, e.g. 2, 4, 6, 8, 10, 12. These top numbers are the hours legend.\n"
    "- The VERTICAL axis is the DAY OF THE MONTH, running TOP to BOTTOM (day 1 at the top, then 2, "
    "3, ... downward). Each day is one horizontal level, lined up with the habit-grid rows to the "
    "left.\n"
    "So for each day (each level going down), the blue point sits at some horizontal position; how "
    "far RIGHT it is gives that day's sleep hours, read against the top hours scale.\n"
    "Work day by day from the top: for day N, find the blue dot on that level, see which top hour "
    "labels it falls between, and read the value; round to the nearest HALF hour (typical values "
    "are 4-10). If small hour numbers are handwritten next to the blue dots, prefer reading those "
    "digits directly. Only include a day if a blue point is clearly there; do NOT guess, "
    "interpolate across gaps, or invent a smooth trend. An omitted day is better than a wrong one "
    "(it is corrected by hand afterwards).\n"
    'Return ONLY a JSON array of objects [{"day": <1-31 integer>, "hours": <number>}], in '
    "ascending day order, no extra text. Skip days with no clear point."
)


_REVIEW_PROMPT = (
    "You are a sharp, practical data analyst and habit coach reviewing ONE person's month of "
    "self-tracked data. Mine the DATA below for as many real, specific insights as it supports, and "
    "ground EVERY statement in its actual numbers (habit names, percentages, the sleep-productivity "
    "correlation, per-day pairs, weekday averages, momentum, keystone lift). Do NOT give generic "
    "wellness advice; if a point is not supported by their data, leave it out. Look for the "
    "non-obvious: which habit's presence lifts the whole day (keystone lift), whether the month "
    "built or faded (momentum), which weekday is the weak link, the sleep threshold above which "
    "their productive days cluster, and any habit that rarely happens without another.\n"
    "Write GitHub-flavored markdown using ### for each section heading:\n"
    "- A one-line opener naming the single biggest pattern in their month (before the first heading).\n"
    "- ### Sleep vs productivity: interpret the correlation and per-day pairs for THIS person; does "
    "more sleep track with more done? Cite specific days, and give the sleep hours their best days "
    "sit above.\n"
    "- ### Keystone habits: from the keystone-lift numbers, name the 1-2 habits whose kept days "
    "coincide with a much more productive day, and say which to protect first.\n"
    "- ### Momentum & rhythm: did the month build or fade (first vs second half numbers)? Name the "
    "strongest and weakest weekday.\n"
    "- ### Working vs slipping: the 1-2 strongest habits (by % or streak) and the 1-2 weakest (by "
    "name and %).\n"
    "- ### Try next month: exactly 3 concrete changes tied to the data, each as its OWN markdown "
    "'- ' bullet on its own line (not prose, not a numbered list): a specific habit to ADD that "
    "supports a weak area, the keystone habit to protect, and a sleep target from their productive "
    "days. Name habits and numbers in every bullet.\n"
    "No medical claims or diagnoses. Never invent data. Never use an em dash. Under ~300 words.\n\n"
    "MONTH DATA:\n"
)


_OVERALL_PROMPT = (
    "You are a sharp data analyst and habit coach reviewing ONE person's ENTIRE history of "
    "self-tracked months (each month's number-rich summary follows, oldest first, separated by "
    "'===='). Read ACROSS the months for the long-arc story a single-month review can't see.\n\n"
    "NON-NEGOTIABLE STYLE RULES (a generic answer is a failed answer):\n"
    "1. EVERY sentence must cite at least one specific number or name pulled from the data below "
    "(a percentage, an hour count, a habit name, a month name, a correlation, a streak, a weekday). "
    "A sentence with no data in it is banned. Delete it.\n"
    "2. Wrap EVERY such value in **bold** with double asterisks: every %, every hour count, every "
    "habit name, every month name, every correlation, every streak length, every weekday.\n"
    "3. Always COMPARE, never just state: 'X in **Mar** vs Y in **Aug**', 'up/down from ** _%** to "
    "** _%**', 'this habit vs that habit'. A number on its own is weaker than the same number next "
    "to what it moved from.\n"
    "4. After each pattern, add WHY it likely happened and what the person should DO about it. "
    "Analysis, not a readout of the numbers.\n"
    "5. Actually use every signal the data gives you (per-month completion, per-habit % over time, "
    "mean sleep per month, sleep-productivity correlation, keystone lift, weekday averages, "
    "half-splits/momentum). Do not skip a section because it's harder.\n"
    "6. No generic wellness advice ('drink water', 'stay consistent', 'get enough sleep'). If a "
    "point isn't backed by a number in the data, cut it. No medical claims. Never invent data. "
    "Never use an em dash.\n\n"
    "Here is the DENSITY and TONE required (invented example, do NOT reuse its numbers):\n"
    "\"Your **Reading** habit is the anchor of every strong month: it hit **91%** in **Feb** and "
    "**88%** in **Mar**, the two months your overall completion also peaked (**79%** and **74%**), "
    "while **Nov**, your worst month at **46%**, is also the only one where **Reading** fell to "
    "**32%**. That is a keystone signal worth protecting first. Sleep tells the same story: your "
    "sleep-productivity correlation was **+0.61** in the three months you averaged over **7.4h**, "
    "but collapsed to **-0.05** in **Nov** at **6.2h**, so the fix isn't more habits, it's guarding "
    "the **7.5h** floor that your best months share.\"\n\n"
    "Now write the review as GitHub-flavored markdown, using ### for each heading:\n"
    "- One opener line naming the single biggest multi-month pattern (before the first heading), "
    "with its numbers bolded.\n"
    "- ### The trajectory: completion trending up, down, or flat? Quote the per-month completion %s "
    "in order, name the best and worst month with their %s, and say what the swing means.\n"
    "- ### What sticks, what slips: name the habits that climbed month over month, the ones that "
    "decayed or were dropped, and the rock-solid ones, each with their % across months.\n"
    "- ### Sleep over time: how mean sleep moved month to month and whether the sleep-productivity "
    "link holds every month or only some. Quote the per-month hours and correlations.\n"
    "- ### Keystone across months: the habit whose kept months repeatedly coincide with higher "
    "overall completion. Name it, show the pairing, say to protect it first.\n"
    "- ### Rhythm across months: recurring strong/weak weekday and whether months tend to fade in "
    "the second half. Cite the weekday averages and half-splits.\n"
    "- ### The next month: exactly 3 concrete changes tied to the trends above, each its OWN "
    "markdown '- ' bullet on its own line, each naming a habit and a target number.\n"
    "Aim for ~450-550 words. Bold every value. Compare, explain, and coach in every section.\n\n"
    "ALL MONTHS DATA:\n"
)


# Transient statuses worth retrying: rate limits (429) and the 5xx a free tier throws under load.
# Free providers (esp. Nvidia) return 500 on concurrent hits — the parallel extract triggers exactly
# that — so 500/502/504 must retry, not just 429/503, or one hiccup fails the whole extraction.
_RETRY_STATUS = frozenset({429, 500, 502, 503, 504})


def _post_chat(base_url: str, api_key: str, payload: dict, timeout: float, retries: int) -> str:
    """One provider's /chat/completions call → reply text, backing off on transient 5xx/429 and
    read timeouts (a slow free model that eventually answers on a retry)."""
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}"}
    resp = None
    for attempt in range(retries + 1):
        try:
            resp = httpx.post(url, json=payload, headers=headers, timeout=timeout)
        except httpx.TimeoutException:
            if attempt < retries:
                time.sleep(3 * (attempt + 1))
                continue
            raise
        if resp.status_code in _RETRY_STATUS and attempt < retries:
            time.sleep(3 * (attempt + 1))
            continue
        break
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _call_chain(providers: list[ProviderCfg], payload_for, timeout: float) -> str:
    """Try each provider in order; fall through to the next on any HTTP/network error. Raises the
    last provider's error if all fail. A provider with a fallback behind it fails FAST (no backoff
    wait) so a 503 hands off to the next provider immediately; only the last one backs off on
    transient 429/503 (there's nothing else to try)."""
    last: Exception | None = None
    for i, p in enumerate(providers):
        retries = 5 if i == len(providers) - 1 else 0  # patient only when there's no fallback left
        try:
            return _post_chat(p.base_url, p.api_key, payload_for(p), timeout, retries)
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            last = e
            _log.warning("provider '%s' failed, trying next: %s", p.name, e)
    raise last if last else RuntimeError("no providers configured")


def _text_call(providers: list[ProviderCfg], prompt: str, timeout: float) -> str:
    """Text chat across the failover chain → reply text."""
    return _call_chain(
        providers,
        lambda p: {"model": p.text_model, "temperature": 0.5, "messages": [{"role": "user", "content": prompt}]},
        timeout,
    )


def _vision_call(providers: list[ProviderCfg], prompt: str, image_png: bytes, timeout: float, max_dim: int = _MAX_DIM) -> str:
    """Vision chat across the failover chain → reply text. The image is downscaled once and reused."""
    vision = [p for p in providers if p.vision_model]  # skip text-only providers (e.g. Groq)
    b64 = base64.b64encode(_downscale_jpeg(image_png, max_dim)).decode()
    content = [
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
    ]
    return _call_chain(
        vision,
        lambda p: {"model": p.vision_model, "temperature": 0, "messages": [{"role": "user", "content": content}]},
        timeout,
    )


class OpenAICompatReviewer:
    def __init__(self, providers: list[ProviderCfg], timeout: float = 60.0):
        self.providers, self.timeout = providers, timeout

    def review(self, summary: str) -> str:
        return _text_call(self.providers, _REVIEW_PROMPT + summary, self.timeout).strip()

    def review_overall(self, summary: str) -> str:
        """Cross-month review over every month's summary concatenated (spec 011)."""
        return _text_call(self.providers, _OVERALL_PROMPT + summary, self.timeout).strip()


def review_from_env() -> OpenAICompatReviewer | None:
    """Text reviewer over the failover chain, or None when no provider key is configured."""
    ps = _providers()
    return OpenAICompatReviewer(ps) if ps else None


class OpenAICompatLabelReader:
    def __init__(self, providers: list[ProviderCfg], timeout: float = 120.0):
        self.providers, self.timeout = providers, timeout

    def read(self, image_png: bytes) -> list[str]:
        return _parse_labels(_vision_call(self.providers, _LABEL_PROMPT, image_png, self.timeout))


class OpenAICompatMomentsReader:
    def __init__(self, providers: list[ProviderCfg], timeout: float = 120.0):
        self.providers, self.timeout = providers, timeout

    def read(self, image_png: bytes) -> list[dict]:
        return _parse_moments(_vision_call(self.providers, _MOMENTS_PROMPT, image_png, self.timeout))


class OpenAICompatSleepReader:
    def __init__(self, providers: list[ProviderCfg], timeout: float = 120.0):
        self.providers, self.timeout = providers, timeout

    def read(self, image_png: bytes) -> list[dict]:
        # Bigger than labels/moments: the sleep line is fine detail that 1024px blurs into mush.
        return _parse_sleep(_vision_call(self.providers, _SLEEP_PROMPT, image_png, self.timeout, max_dim=1600))


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


def _parse_sleep(text: str) -> list[dict]:
    """Pull a JSON array of {day, hours} out of the reply; drop malformed/out-of-range."""
    m = re.search(r"\[.*\]", text, re.DOTALL)
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
        try:
            hours = float(item.get("hours"))
        except (TypeError, ValueError):
            continue
        if 1 <= day <= 31 and 0 <= hours <= 24:
            out.append({"day": day, "hours": round(hours, 1)})
    return out


def _providers() -> list[ProviderCfg]:
    """The ordered failover chain from env keys (Google → Groq → Nvidia), only the ones with a key.
    An explicit LABEL_READER_API_KEY still wins as a single custom provider (back-compat)."""
    override = os.getenv("LABEL_READER_API_KEY")
    if override and override.strip():
        base = os.getenv("LABEL_READER_BASE_URL", _DEFAULT_BASE)
        model = os.getenv("LABEL_READER_MODEL", _DEFAULT_MODEL)
        return [ProviderCfg("custom", base, override.strip(), model, model)]
    out: list[ProviderCfg] = []
    for name, base, env, vmodel, tmodel in _PROVIDER_SPECS:
        k = os.getenv(env)
        if k and k.strip():
            out.append(ProviderCfg(name, base, k.strip(), vmodel, tmodel))
    return out


def from_env() -> LabelReader:
    ps = _providers()
    return OpenAICompatLabelReader(ps) if ps else NullLabelReader()


def moments_from_env() -> MomentsReader:
    ps = _providers()
    return OpenAICompatMomentsReader(ps) if ps else NullMomentsReader()


def sleep_from_env() -> SleepReader:
    ps = _providers()
    return OpenAICompatSleepReader(ps) if ps else NullSleepReader()
