// Model — pure transforms between the wire Extraction (spec 002) and the editable Draft.
import { CONTRACT_VERSION, type CellStatus, type Extraction } from "../contract";
import type { Draft } from "./types";

const CYCLE: Record<CellStatus, CellStatus> = { done: "missed", missed: "empty", empty: "done" };

/** Blank → placeholder, and de-duplicate (the contract forbids blank/duplicate habit names). */
function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((n, i) => {
    let name = n.trim() || `Habit ${i + 1}`;
    const base = name;
    let k = 2;
    while (seen.has(name)) name = `${base} (${k++})`;
    seen.add(name);
    return name;
  });
}

export function draftFromExtraction(ex: Extraction, rectified: string, days: number): Draft {
  const rows = ex.habits.length;
  const status: CellStatus[][] = Array.from({ length: rows }, () => Array<CellStatus>(days).fill("empty"));
  const conf: number[][] = Array.from({ length: rows }, () => Array<number>(days).fill(1));
  const idx = new Map(ex.habits.map((h, i) => [h.name, i]));
  for (const c of ex.cells) {
    const r = idx.get(c.habit);
    if (r === undefined || c.day < 1 || c.day > days) continue;
    status[r][c.day - 1] = c.status;
    conf[r][c.day - 1] = c.confidence;
  }
  const habits = ex.habits.map((h) => h.name);
  // Default to Fajr-first: the reader reads the rotated photo top→bottom (Quit Sugar first), so
  // reverse rows to match the reference image (Fajr first). Flip ⇅ re-toggles for a month that
  // reads the other way. ponytail: heuristic default, not detection.
  habits.reverse();
  status.reverse();
  conf.reverse();
  const moments = ex.moments
    .map((m) => ({ day: m.day, text: m.text }))
    .sort((a, b) => a.day - b.day);
  const sleep = Array<number | null>(days).fill(null);
  for (const s of ex.sleep) {
    if (s.hours != null && s.day >= 1 && s.day <= days) sleep[s.day - 1] = s.hours;
  }
  return { year: ex.year, month: ex.month, days, habits, status, conf, sleep, moments, rectified };
}

export function toExtraction(d: Draft): Extraction {
  const habits = uniqueNames(d.habits);
  const cells = [];
  for (let r = 0; r < habits.length; r++) {
    for (let day = 1; day <= d.days; day++) {
      const st = d.status[r][day - 1];
      if (st === "empty") continue;
      cells.push({ day, habit: habits[r], status: st, confidence: d.conf[r][day - 1] });
    }
  }
  // Drop blank text; keep the first moment per day (the contract forbids duplicate/blank).
  const byDay = new Set<number>();
  const moments = d.moments
    .filter((m) => m.text.trim() && m.day >= 1 && m.day <= d.days && !byDay.has(m.day) && byDay.add(m.day))
    .map((m) => ({ day: m.day, weekday: null, text: m.text.trim(), lang: null }));
  const sleep = d.sleep
    .map((hours, i) => ({ day: i + 1, hours, confidence: 1 }))
    .filter((s) => s.hours != null) as { day: number; hours: number; confidence: number }[];
  return {
    contract_version: CONTRACT_VERSION,
    year: d.year,
    month: d.month,
    habits: habits.map((name, i) => ({ name, kind: "build" as const, sort_order: i })),
    cells,
    sleep,
    moments,
    flags: [],
  };
}

/** Set a day's sleep hours (day is 1-indexed); null/NaN/out-of-range clears it. */
export function setSleep(d: Draft, day: number, hours: number | null): Draft {
  const v = hours == null || Number.isNaN(hours) || hours < 0 || hours > 24 ? null : hours;
  const sleep = d.sleep.slice();
  sleep[day - 1] = v;
  return { ...d, sleep };
}

/** Add an empty moment on the first free day (for manual entry in review). */
export function addMoment(d: Draft): Draft {
  const used = new Set(d.moments.map((m) => m.day));
  let day = 1;
  while (day < d.days && used.has(day)) day++;
  return { ...d, moments: [...d.moments, { day, text: "" }] };
}

export function setMomentDay(d: Draft, i: number, day: number): Draft {
  const moments = d.moments.map((m, j) => (j === i ? { ...m, day } : m));
  return { ...d, moments };
}

export function setMomentText(d: Draft, i: number, text: string): Draft {
  const moments = d.moments.map((m, j) => (j === i ? { ...m, text } : m));
  return { ...d, moments };
}

export function removeMoment(d: Draft, i: number): Draft {
  return { ...d, moments: d.moments.filter((_, j) => j !== i) };
}

/** Reverse the row order (name + its cells travel together) — display fix, not a data change. */
export function flipDraft(d: Draft): Draft {
  return { ...d, habits: [...d.habits].reverse(), status: [...d.status].reverse(), conf: [...d.conf].reverse() };
}

/** Cycle a cell done → missed → empty. */
export function cycleCell(d: Draft, r: number, day: number): Draft {
  const status = d.status.map((row) => row.slice());
  status[r][day - 1] = CYCLE[status[r][day - 1]];
  return { ...d, status };
}

export function renameHabit(d: Draft, r: number, name: string): Draft {
  const habits = d.habits.slice();
  habits[r] = name;
  return { ...d, habits };
}
