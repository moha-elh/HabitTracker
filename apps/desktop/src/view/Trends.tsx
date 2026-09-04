// View — month-over-month trends (spec 011). Fetches every committed month, reduces each with the
// shared analytics (trendSeries → monthSummary), and charts completion, sleep, and per-habit %.
// Rendering only; all numbers come from model/analytics.
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";
import { fetchMonth, fetchMonths, fetchOverallReview } from "../model/api";
import type { MonthData } from "../model/types";
import { type MonthSummary, trendSeries } from "../model/analytics";
import { MON3, PANEL } from "./theme";
import { renderReview } from "./Markdown";

const msg = (e: unknown) => String(e instanceof Error ? e.message : e);
const label = (s: { year: number; month: number }) => `${MON3[s.month - 1]} ${String(s.year).slice(2)}`;

// Merge habit names that differ only by case / spacing / punctuation across months (e.g.
// "Self Control" vs "self control", "1 Page of Qur'an" vs "1 Page of Quran"). Genuine spelling
// differences ("Editig" vs "Editing") stay separate — those are real data typos to fix at the source.
const norm = (s: string) => s.trim().toLowerCase().replace(/['’.]/g, "").replace(/\s+/g, " ");

// Chart x-domain: walk the committed months forward to at least `min` slots so a couple of months
// don't stretch across the whole chart; the untracked trailing months read as "not filled yet".
function chartMonths(series: MonthSummary[], min = 6): { year: number; month: number; s: MonthSummary | null }[] {
  if (!series.length) return [];
  const byKey = new Map(series.map((s) => [`${s.year}-${s.month}`, s]));
  const out: { year: number; month: number; s: MonthSummary | null }[] = [];
  let y = series[0].year, m = series[0].month;
  for (let i = 0; i < Math.max(series.length, min); i++) {
    out.push({ year: y, month: m, s: byKey.get(`${y}-${m}`) ?? null });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/** Green tint for a 0–100 completion cell (blank when null/absent). */
function heat(pct: number | null): { bg: string; color: string } {
  if (pct === null) return { bg: "transparent", color: "var(--hc-text-faint)" };
  const a = 0.12 + (pct / 100) * 0.68; // 0% barely tinted → 100% solid
  return { bg: `color-mix(in srgb, var(--hc-done) ${Math.round(a * 100)}%, transparent)`, color: pct >= 62 ? "#fff" : "var(--hc-text-body)" };
}

// integers stay integer, floats show one decimal (so a raw mean like 7.8548… reads as "7.9")
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString());

/** Minimal line chart over the months: values[i] may be null (gap). vmax fixes the y-scale.
 * The line + gridlines live in a stretched SVG (a line stays a line under non-uniform scale), but
 * the dots and value labels are overlaid as HTML so they stay round and undistorted. */
function MiniLine({ values, vmax, unit, stroke }: { values: (number | null)[]; vmax: number; unit: string; stroke: string }) {
  const n = values.length;
  const H = 150;
  const xPct = (i: number) => ((i + 0.5) / n) * 100; // center each month in its column (matches the axis)
  const yPx = (v: number) => ((158 - (v / vmax) * 150) / 160) * H;
  const pts = values.map((v, i) => (v === null ? null : { v, i })).filter((p): p is { v: number; i: number } => p !== null);
  const line = pts.length ? "M" + pts.map((p) => `${(((p.i + 0.5) / n) * 600).toFixed(1)},${(158 - (p.v / vmax) * 150).toFixed(1)}`).join("L") : "";
  return (
    <div style={{ position: "relative", height: H }}>
      <svg viewBox="0 0 600 160" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}>
        {[8, 83, 158].map((y) => <line key={y} x1="0" y1={y} x2="600" y2={y} stroke="var(--hc-rule)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {pts.length > 1 && <path d={line} fill="none" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      </svg>
      {pts.map((p) => {
        const y = yPx(p.v);
        return (
          <div key={p.i}>
            <div style={{ position: "absolute", left: `${xPct(p.i)}%`, top: y, transform: "translate(-50%,-50%)", width: 9, height: 9, borderRadius: "50%", background: "#fff", border: `2.5px solid ${stroke}`, boxSizing: "border-box" }} />
            <div style={{ position: "absolute", left: `${xPct(p.i)}%`, top: y < 22 ? y + 12 : y - 20, transform: "translateX(-50%)", fontSize: 11, color: "var(--hc-text-muted)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmt(p.v)}{unit}</div>
          </div>
        );
      })}
    </div>
  );
}

function ChartCard({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div style={{ ...PANEL, padding: "20px 22px 18px" }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.01em" }}>{title}</div>
        <div style={{ fontSize: 11.5, color: "var(--hc-text-faint)", marginTop: 3 }}>{sub}</div>
      </div>
      {children}
    </div>
  );
}

function MonthAxis({ months }: { months: { year: number; month: number }[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${months.length}, 1fr)`, marginTop: 7 }}>
      {months.map((s) => (
        <div key={`${s.year}-${s.month}`} style={{ fontSize: 10, color: "var(--hc-text-faint)", textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{label(s)}</div>
      ))}
    </div>
  );
}

type PctFn = (key: string, s: MonthSummary) => number | null;
type Groups = { key: string; name: string }[];

/** Month x habit heatmap with a low->high legend. */
function HabitHeatmap({ groups, months, pct }: { groups: Groups; months: MonthSummary[]; pct: PctFn }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 6, width: "100%", minWidth: 360 }}>
        <thead>
          <tr>
            <th />
            {months.map((s) => <th key={`${s.year}-${s.month}`} style={{ fontSize: 11.5, fontWeight: 700, color: "var(--hc-text-muted)", textAlign: "center", minWidth: 56 }}>{label(s)}</th>)}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key}>
              <td style={{ fontSize: 12.5, fontWeight: 500, color: "var(--hc-text-body)", padding: "0 10px 0 4px", whiteSpace: "nowrap", maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis" }} title={g.name}>{g.name}</td>
              {months.map((s) => {
                const p = pct(g.key, s);
                const { bg, color } = heat(p);
                return <td key={`${s.year}-${s.month}`} style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color, background: bg, borderRadius: 8, height: 34, fontVariantNumeric: "tabular-nums" }}>{p === null ? "" : `${p}%`}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 11, color: "var(--hc-text-faint)" }}>
        <span>0%</span>
        <div style={{ width: 130, height: 8, borderRadius: 4, background: "linear-gradient(to right, color-mix(in srgb, var(--hc-done) 12%, transparent), var(--hc-done))" }} />
        <span>100%</span>
      </div>
    </div>
  );
}

function Metric({ label: lbl, value, sub, accent, tip }: { label: string; value: string; sub?: string; accent?: string; tip?: string }) {
  return (
    <div title={tip} style={{ background: "var(--hc-surface-sunk)", borderRadius: 12, padding: "12px 14px", minWidth: 0, cursor: tip ? "help" : "default" }}>
      <div style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--hc-text-faint)", fontWeight: 700 }}>{lbl}</div>
      <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4, color: accent ?? "var(--hc-text)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--hc-text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
    </div>
  );
}

/** Cross-month report: computed metric tiles plus an on-demand AI narrative that is cached
 * server-side until the set of committed months changes. */
function OverallReview({ series, groups, pct }: { series: MonthSummary[]; groups: Groups; pct: PctFn }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [text, setText] = useState("");
  const [stale, setStale] = useState(false);
  const [err, setErr] = useState("");

  // Nothing is shown or fetched on load — the review appears only after the user clicks Generate.
  // A click with a valid cached review still returns instantly (no AI call); it only generates when
  // the cache is missing or the months changed.
  const run = async (refresh: boolean) => {
    setState("loading"); setErr("");
    try {
      const r = await fetchOverallReview(refresh);
      setText(r.review); setStale(r.stale); setState("done");
    } catch (e) { setErr(msg(e)); setState("error"); }
  };

  // --- computed metrics (no AI needed) ---
  const n = series.length;
  const avgCompletion = Math.round(series.reduce((a, s) => a + s.completion, 0) / n);
  const bestMonth = series.reduce((a, s) => (s.completion > a.completion ? s : a));
  const worstMonth = series.reduce((a, s) => (s.completion < a.completion ? s : a));
  const first = series[0], last = series[n - 1];
  const delta = last.completion - first.completion; // trend over the tracked span
  const sleepMonths = series.filter((s) => s.meanSleep !== null);
  const meanSleepAll = sleepMonths.length ? sleepMonths.reduce((a, s) => a + (s.meanSleep as number), 0) / sleepMonths.length : null;
  const bestStreak = series.reduce((a, s) => Math.max(a, s.bestStreak), 0);

  // Habit leaderboard: each habit's average completion across the months it was tracked.
  const leaderboard = groups
    .map((g) => {
      const vals = series.map((s) => pct(g.key, s)).filter((v): v is number => v !== null);
      return { name: g.name, avg: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0 };
    })
    .sort((a, b) => b.avg - a.avg);

  return (
    <ChartCard title="Full review ✨" sub={`Metrics and an AI read across all ${n} committed month${n === 1 ? "" : "s"}, refreshed when you add or change a month`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
        <Metric label="Months" value={String(n)} sub={`${label(first)} to ${label(last)}`} tip="How many committed months this review covers, from your first tracked month to your latest." />
        <Metric label="Avg completion" value={`${avgCompletion}%`} sub="across all months" tip="Average of each month's completion (the percent of tracked habit cells you marked done), across every committed month." />
        <Metric label="Best month" value={`${bestMonth.completion}%`} sub={label(bestMonth)} tip={`Your highest-completion month so far: ${label(bestMonth)} at ${bestMonth.completion}%.`} />
        <Metric label="Worst month" value={`${worstMonth.completion}%`} sub={label(worstMonth)} tip={`Your lowest-completion month so far: ${label(worstMonth)} at ${worstMonth.completion}%. A place to look at what got in the way.`} />
        <Metric label="Trend" value={n < 2 ? "·" : `${delta > 0 ? "+" : ""}${delta}%`} accent={n < 2 ? undefined : delta >= 0 ? "var(--hc-done-text)" : "var(--hc-missed-text)"} sub={n < 2 ? "one month so far" : delta > 0 ? "improving" : delta < 0 ? "slipping" : "holding steady"} tip="Change in completion from your first tracked month to your latest. Positive means you're improving overall, negative means you're slipping. Needs at least 2 months." />
        <Metric label="Mean sleep" value={meanSleepAll !== null ? `${fmt(Math.round(meanSleepAll * 10) / 10)}h` : "·"} sub={meanSleepAll !== null ? `${sleepMonths.length} month${sleepMonths.length === 1 ? "" : "s"} logged` : "no sleep logged"} tip="Average hours of sleep per night, averaged over the months where you logged any sleep. Months with no sleep data are skipped." />
        <Metric label="Top habit" value={leaderboard[0] ? `${leaderboard[0].avg}%` : "·"} sub={leaderboard[0]?.name} tip={leaderboard[0] ? `Your most consistent habit across the months: ${leaderboard[0].name}, done ${leaderboard[0].avg}% of tracked days on average.` : "Your most consistent habit across all months."} />
        <Metric label="Best streak" value={bestStreak ? `${bestStreak}d` : "·"} sub="longest run, any month" tip="The longest unbroken run of done days for any single habit in any month. Your record streak so far." />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "22px 0 12px" }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--hc-text)", letterSpacing: "-.01em" }}>AI review across the months ✨</div>
        {state === "idle" && <button onClick={() => run(false)} style={reviewBtn}>Generate AI review</button>}
      </div>
      {state === "loading" && <div style={{ fontSize: 13, color: "var(--hc-text-muted)" }}>Reading every month…</div>}
      {state === "error" && (
        <div>
          <div style={{ fontSize: 12.5, color: "var(--hc-flag-text)", marginBottom: 10 }}>{err}</div>
          <button onClick={() => run(false)} style={reviewBtn}>Try again</button>
        </div>
      )}
      {state === "done" && (
        <div>
          {stale && <div style={{ fontSize: 11.5, color: "var(--hc-flag-text)", marginBottom: 8 }}>Your months changed since this was written. Add an AI key to regenerate.</div>}
          <div>{renderReview(text)}</div>
          <button onClick={() => run(true)} style={{ ...reviewBtn, marginTop: 14, background: "var(--hc-surface-sunk)", color: "var(--hc-text-muted)", border: "1px solid var(--hc-border)" }}>Regenerate</button>
        </div>
      )}
    </ChartCard>
  );
}

const reviewBtn: CSSProperties = {
  padding: "9px 16px", fontSize: 13, fontWeight: 700, borderRadius: 9, cursor: "pointer",
  fontFamily: "var(--hc-font-body)", background: "var(--hc-surface-ink)", color: "#fff", border: "none",
};

export function TrendsView() {
  const [series, setSeries] = useState<MonthSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await fetchMonths();
        const data: MonthData[] = await Promise.all(list.map((m) => fetchMonth(m.year, m.month)));
        setSeries(trendSeries(data));
      } catch (e) { setErr(msg(e)); }
    })();
  }, []);

  // union of habits across months, grouped by normalized name (merges case/spacing/punctuation
  // variants), keeping the first-seen spelling as the display name.
  const habitGroups = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of series ?? []) for (const h of s.perHabit) { const k = norm(h.name); if (!map.has(k)) map.set(k, h.name); }
    return [...map.entries()].map(([key, name]) => ({ key, name }));
  }, [series]);

  if (err) return <p style={{ color: "var(--hc-flag-text)" }}>{err}</p>;
  if (!series) return <p style={{ color: "var(--hc-text-muted)" }}>loading…</p>;
  if (series.length === 0) return <p style={{ color: "var(--hc-text-muted)" }}>No months yet. Import one from the Import tab.</p>;

  const cm = chartMonths(series); // padded with trailing untracked months so the line isn't stretched
  const completionVals = cm.map((c) => (c.s ? c.s.completion : null));
  const sleepVals = cm.map((c) => (c.s ? c.s.meanSleep : null));
  const hasSleep = series.some((s) => s.meanSleep !== null);
  const sleepMax = Math.max(10, ...series.map((s) => s.meanSleep).filter((v): v is number => v !== null));
  const pctByHabit = (key: string, s: MonthSummary) => s.perHabit.find((h) => norm(h.name) === key)?.pct ?? null;

  return (
    <div style={{ width: "100%", display: "grid", gap: 14, textAlign: "left" }}>
      <div>
        <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--hc-text-label)", fontWeight: 700, marginBottom: 6 }}>Habit Chronicle</div>
        <div style={{ fontSize: 40, fontWeight: 400, lineHeight: 1, fontFamily: "var(--hc-font-display)" }}>Trends</div>
        <div style={{ fontSize: 13, color: "var(--hc-text-muted)", marginTop: 8 }}>
          {series.length} month{series.length === 1 ? "" : "s"} committed{series.length < 2 ? " · trends need at least 2 months" : ""}
        </div>
      </div>

      <ChartCard title="Completion" sub="Percent of tracked cells done, per month">
        <MiniLine values={completionVals} vmax={100} unit="%" stroke="var(--hc-done)" />
        <MonthAxis months={cm} />
      </ChartCard>

      {hasSleep && (
        <ChartCard title="Mean sleep" sub="Average hours per night, per month (months with no sleep logged are skipped)">
          <MiniLine values={sleepVals} vmax={sleepMax} unit="h" stroke="var(--hc-sleep)" />
          <MonthAxis months={cm} />
        </ChartCard>
      )}

      <ChartCard title="Per-habit completion" sub="Each habit's monthly completion %; blank where the habit wasn't tracked that month">
        <HabitHeatmap groups={habitGroups} months={series} pct={pctByHabit} />
      </ChartCard>

      <OverallReview series={series} groups={habitGroups} pct={pctByHabit} />
    </div>
  );
}
