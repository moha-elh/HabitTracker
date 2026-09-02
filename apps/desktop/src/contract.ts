// Extraction contract — 1:1 mirror of services/pipeline/pipeline/contract.py (CLAUDE.md §5).
// The single cross-boundary agreement. Keep field names, enum values, and CONTRACT_VERSION
// in lockstep with the Python source; bump both deliberately on any schema change (§10).

export const CONTRACT_VERSION = 1;

export type HabitKind = "build" | "eliminate";
export type CellStatus = "done" | "missed" | "empty";

export interface Habit {
  name: string;
  kind: HabitKind; // default "build" on the Python side
  sort_order: number;
}

export interface Cell {
  day: number; // 1..31
  habit: string; // matches a Habit.name
  status: CellStatus;
  confidence: number; // 0..1
}

export interface SleepReading {
  day: number; // 1..31
  hours: number | null;
  confidence: number; // 0..1
}

export interface Moment {
  day: number; // 1..31
  weekday: string | null;
  text: string;
  lang: string | null; // best-effort "en" | "fr" | "dar" | null
}

export interface DayFlag {
  day: number; // 1..31
  reason: string;
}

export interface Extraction {
  contract_version: number; // must equal CONTRACT_VERSION
  year: number;
  month: number; // 1..12
  habits: Habit[];
  cells: Cell[];
  sleep: SleepReading[];
  moments: Moment[];
  flags: DayFlag[];
}
