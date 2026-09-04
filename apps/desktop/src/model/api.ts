// Model — the only place that talks to the Python sidecar over loopback HTTP.
import { invoke } from "@tauri-apps/api/core";
import type { Extraction } from "../contract";
import type { MonthData, MonthItem } from "./types";

async function apiBase(): Promise<string> {
  const port = await invoke<number>("sidecar_port");
  return `http://127.0.0.1:${port}`;
}

async function detailError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({} as { detail?: unknown }));
  const detail = (body as { detail?: unknown }).detail;
  return new Error(typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : `${fallback} (${res.status})`);
}

export type ExtractResult = { extraction: Extraction; referenceB64: string; momentsStatus: string; sleepStatus: string };

/** Grid photo (+ optional moments photo) → draft extraction + reference (base64). Sleep is read
 * from the grid image itself (its chart sits beside the grid). */
export async function extractImage(file: File, momentsFile: File | null, year: number, month: number, days: number): Promise<ExtractResult> {
  const form = new FormData();
  form.append("image", file);
  form.append("year", String(year));
  form.append("month", String(month));
  form.append("days", String(days));
  if (momentsFile) form.append("moments_image", momentsFile);
  const res = await fetch(`${await apiBase()}/extract`, { method: "POST", body: form });
  if (!res.ok) throw await detailError(res, "extract failed");
  const body = await res.json();
  // reference_png_b64 includes the handwritten name margin; fall back to the tight crop for an
  // older sidecar that predates it, so something always shows.
  return {
    extraction: body.extraction as Extraction,
    referenceB64: body.reference_png_b64 || body.rectified_png_b64,
    momentsStatus: body.moments_status ?? "no image", // absent → sidecar predates page reads
    sleepStatus: body.sleep_status ?? "no image",
  };
}

/** Persist a reviewed extraction plus the source photos to archive. Idempotent on (year, month). */
export async function commitExtraction(
  ex: Extraction,
  images: { grid_image: string | null; moments_image: string | null } = { grid_image: null, moments_image: null },
): Promise<{ entries: number; year: number; month: number }> {
  const res = await fetch(`${await apiBase()}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ extraction: ex, ...images }),
  });
  if (!res.ok) throw await detailError(res, "commit failed");
  return res.json();
}

/** Stored source photos (data URLs) for a committed month; either may be null. */
export async function fetchMonthImages(year: number, month: number): Promise<{ grid: string | null; moments: string | null }> {
  const res = await fetch(`${await apiBase()}/months/${year}/${month}/images`);
  if (!res.ok) throw await detailError(res, "images load failed");
  return res.json();
}

/** LLM review + lifestyle advice for a committed month (markdown text). Cached server-side after
 * the first call; pass refresh to force a regenerate. */
export async function fetchMonthReview(year: number, month: number, refresh = false): Promise<string> {
  const res = await fetch(`${await apiBase()}/months/${year}/${month}/review${refresh ? "?refresh=true" : ""}`);
  if (!res.ok) throw await detailError(res, "review failed");
  return (await res.json()).review as string;
}

/** LLM review across ALL committed months (markdown). Cached server-side and only regenerated when
 * the set of committed months changes; pass refresh to force it. `stale` = a cached review from a
 * different set of months (served because no API key is configured to regenerate). */
export async function fetchOverallReview(refresh = false): Promise<{ review: string; cached: boolean; months: number; stale: boolean }> {
  const res = await fetch(`${await apiBase()}/review/overall${refresh ? "?refresh=true" : ""}`);
  if (!res.ok) throw await detailError(res, "overall review failed");
  return res.json();
}

/** Persist the (absolute) confetti click count for a month; returns the stored value. */
export async function saveConfetti(year: number, month: number, count: number): Promise<number> {
  const res = await fetch(`${await apiBase()}/months/${year}/${month}/confetti`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count }),
  });
  if (!res.ok) throw await detailError(res, "confetti save failed");
  return (await res.json()).count as number;
}

/** Delete a committed month and all its data (grid, sleep, moments). Irreversible. */
export async function deleteMonth(year: number, month: number): Promise<void> {
  const res = await fetch(`${await apiBase()}/months/${year}/${month}`, { method: "DELETE" });
  if (!res.ok) throw await detailError(res, "delete failed");
}

export async function fetchMonths(): Promise<MonthItem[]> {
  const res = await fetch(`${await apiBase()}/months`);
  if (!res.ok) throw await detailError(res, "months list failed");
  return res.json();
}

export async function fetchMonth(year: number, month: number): Promise<MonthData> {
  const res = await fetch(`${await apiBase()}/months/${year}/${month}`);
  if (!res.ok) throw await detailError(res, "month load failed");
  return res.json();
}
