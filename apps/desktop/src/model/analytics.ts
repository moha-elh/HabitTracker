// Model — derived dashboard metrics. Everything is computed here at read time; nothing is
// stored (CLAUDE.md §6: the grid stays the single source of truth).
import type { CellStatus } from "../contract";
import type { MonthData } from "./types";

export const pct = (done: number, missed: number): number | null =>
  done + missed === 0 ? null : Math.round((100 * done) / (done + missed));

/** Longest run of consecutive "done" days in a row → {len, start-day, end-day} (1-indexed). */
export function longestRun(row: CellStatus[]): { len: number; start: number; end: number } {
  let best = { len: 0, start: 0, end: 0 };
  let cur = 0;
  let curStart = 0;
  for (let d = 0; d < row.length; d++) {
    if (row[d] === "done") {
      if (cur === 0) curStart = d + 1;
      cur++;
      if (cur > best.len) best = { len: cur, start: curStart, end: d + 1 };
    } else {
      cur = 0;
    }
  }
  return best;
}

/** status[habit][day-1] from a committed month's entries; missing cells = "empty". */
export function buildMatrix(data: MonthData): CellStatus[][] {
  const { days, habits } = data;
  const s = habits.map(() => Array<CellStatus>(days).fill("empty"));
  const hidx = new Map(habits.map((h, i) => [h.name, i]));
  for (const e of data.entries) {
    const r = hidx.get(e.habit);
    if (r === undefined || e.day < 1 || e.day > days) continue;
    s[r][e.day - 1] = e.done ? "done" : "missed";
  }
  return s;
}

export type HabitStat = { name: string; pct: number | null; run: { len: number; start: number; end: number } };
export type MonthStats = {
  dayTotals: number[];
  done: number;
  missed: number;
  monthly: number;
  perHabit: HabitStat[];
  best: HabitStat;
  bestDay: number;
  worstDay: number;
  hasTracked: boolean;
  sleepByDay: Map<number, number>;
  momentByDay: Map<number, string>;
  hasSleep: boolean;
  meanSleep: number;
  sdSleep: number;
  minSleep: { day: number; hours: number } | null;
};

export function monthStats(data: MonthData, status: CellStatus[][]): MonthStats {
  const { days, habits } = data;
  const dayTotals = Array<number>(days).fill(0);
  const dayTracked = Array<number>(days).fill(0);
  let done = 0;
  let missed = 0;
  for (let r = 0; r < habits.length; r++) {
    for (let d = 0; d < days; d++) {
      const st = status[r][d];
      if (st === "done") { done++; dayTotals[d]++; dayTracked[d]++; }
      else if (st === "missed") { missed++; dayTracked[d]++; }
    }
  }
  const monthly = pct(done, missed) ?? 0;
  const perHabit: HabitStat[] = habits.map((h, r) => {
    let hd = 0;
    let hm = 0;
    for (let d = 0; d < days; d++) { if (status[r][d] === "done") hd++; else if (status[r][d] === "missed") hm++; }
    return { name: h.name, pct: pct(hd, hm), run: longestRun(status[r]) };
  });
  const best = perHabit.reduce(
    (a, b) => (b.run.len > a.run.len ? b : a),
    perHabit[0] ?? { name: "", pct: null, run: { len: 0, start: 0, end: 0 } },
  );
  // best / worst day among days that have any tracked cell
  let bestDay = 1;
  let worstDay = 1;
  let hasTracked = false;
  for (let d = 0; d < days; d++) {
    if (!dayTracked[d]) continue;
    if (!hasTracked) { bestDay = worstDay = d + 1; hasTracked = true; continue; }
    if (dayTotals[d] > dayTotals[bestDay - 1]) bestDay = d + 1;
    if (dayTotals[d] < dayTotals[worstDay - 1]) worstDay = d + 1;
  }
  const hasSleep = data.sleep.length > 0;
  const hrs = data.sleep.map((s) => s.hours);
  const meanSleep = hasSleep ? hrs.reduce((a, b) => a + b, 0) / hrs.length : 0;
  const sdSleep = hasSleep ? Math.sqrt(hrs.reduce((a, b) => a + (b - meanSleep) ** 2, 0) / hrs.length) : 0;
  const minSleep = hasSleep ? data.sleep.reduce((a, b) => (b.hours < a.hours ? b : a)) : null;
  return {
    dayTotals, done, missed, monthly, perHabit, best, bestDay, worstDay, hasTracked,
    sleepByDay: new Map(data.sleep.map((s) => [s.day, s.hours])),
    momentByDay: new Map(data.moments.map((m) => [m.day, m.text])),
    hasSleep, meanSleep, sdSleep, minSleep,
  };
}
