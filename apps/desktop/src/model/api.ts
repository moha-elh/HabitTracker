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

export type ExtractResult = { extraction: Extraction; referenceB64: string; momentsStatus: string };

/** Grid photo (+ optional moments photo) → draft extraction + the reference image (base64 PNG). */
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
    momentsStatus: body.moments_status ?? "no image", // absent → sidecar predates moments support
  };
}

/** Persist a reviewed extraction. Idempotent on (year, month). */
export async function commitExtraction(ex: Extraction): Promise<{ entries: number; year: number; month: number }> {
  const res = await fetch(`${await apiBase()}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ex),
  });
  if (!res.ok) throw await detailError(res, "commit failed");
  return res.json();
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
