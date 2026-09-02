// Model — shared view/domain types. No React, no framework.
import type { CellStatus } from "../contract";

/** The editable, in-review month: a habit×day grid the user corrects before commit. */
export type Draft = {
  year: number;
  month: number;
  days: number;
  habits: string[];
  status: CellStatus[][]; // [row][day-1]
  conf: number[][]; // [row][day-1]
  sleep: (number | null)[]; // hours per night, indexed by day-1; null = no reading
  moments: { day: number; text: string }[]; // memorable moments (left page), editable in review
  rectified: string; // reference image, data URL
};

/** The controller's screen state machine. */
export type View =
  | { v: "import" }
  | { v: "loading" }
  | { v: "review"; draft: Draft }
  | { v: "committing"; draft: Draft }
  | { v: "done"; counts: { entries: number; year: number; month: number } }
  | { v: "dashboard" };

/** A committed month as listed by GET /months. */
export type MonthItem = { year: number; month: number; imported_at: string; entries: number };

/** A committed month's full payload from GET /months/{year}/{month}. */
export type MonthData = {
  year: number;
  month: number;
  days: number;
  habits: { name: string; kind: string; sort_order: number }[];
  entries: { day: number; habit: string; done: number }[];
  sleep: { day: number; hours: number }[];
  moments: { day: number; weekday: string | null; text: string }[];
};
