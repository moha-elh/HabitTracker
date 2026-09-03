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
  rectified: string; // grid reference image (data URL) at the current orientation, archived on commit
  referenceRaw: string; // the server reference, unrotated, so review can re-orient it freely
  refDeg: number; // clockwise rotation currently applied to referenceRaw (0/90/180/270)
  gridPhoto: string; // the full original grid photo (data URL); has the sleep line chart the crop drops
  momentsImage: string | null; // moments-page photo (data URL), if one was uploaded
};

/** The controller's screen state machine. */
export type View =
  | { v: "import" }
  | { v: "loading" }
  | { v: "review"; draft: Draft }
  | { v: "committing"; draft: Draft }
  | { v: "done"; counts: { entries: number; year: number; month: number } }
  | { v: "dashboard" }
  | { v: "trends" };

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
  confetti: number; // persistent silly click counter (spec 013)
  review: string | null; // cached LLM review markdown, or null if never generated
};
