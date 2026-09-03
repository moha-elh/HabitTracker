// View — month-over-month trends (spec 011). Fetches every committed month, reduces each with the
// shared analytics (trendSeries → monthSummary), and charts completion, sleep, and per-habit %.
// Rendering only; all numbers come from model/analytics.
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { fetchMonth, fetchMonths } from "../model/api";
import type { MonthData } from "../model/types";
import { type MonthSummary, trendSeries } from "../model/analytics";
import { MON3, PANEL } from "./theme";

const msg = (e: unknown) => String(e instanceof Error ? e.message : e);
const label = (s: { year: number; month: number }) => `${MON3[s.month - 1]} ${String(s.year).slice(2)}`;

/** Green tint for a 0–100 completion cell (blank when null/absent). */
function heat(pct: number | null): { bg: string; color: string } {
  if (pct === null) return { bg: "transparent", color: "var(--hc-text-faint)" };
  const a = 0.12 + (pct / 100) * 0.68; // 0% barely tinted → 100% solid
  return { bg: `color-mix(in srgb, var(--hc-done) ${Math.round(a * 100)}%, transparent)`, color: pct >= 62 ? "#fff" : "var(--hc-text-body)" };
}

/** Minimal line chart over the months: values[i] may be null (gap). vmax fixes the y-scale. */
function MiniLine({ values, vmax, unit, stroke }: { values: (number | null)[]; vmax: number; unit: string; stroke: string }) {
  const n = values.length;
  const X = (i: number) => (n > 1 ? (i / (n - 1)) * 600 : 300);
  const Y = (v: number) => 158 - (v / vmax) * 150;
  const pts = values.map((v, i) => (v === null ? null : { x: X(i), y: Y(v), v, i })).filter((p): p is { x: number; y: number; v: number; i: number } => p !== null);
  // draw one polyline through the present points (gaps just connect across — months without data are rare)
  const line = pts.length ? "M" + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("L") : "";
  return (
    <svg viewBox="0 0 600 160" preserveAspectRatio="none" style={{ width: "100%", height: 150, display: "block", overflow: "visible" }}>
      {[8, 83, 158].map((y) => <line key={y} x1="0" y1={y} x2="600" y2={y} stroke="var(--hc-rule)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
      {pts.length > 1 && <path d={line} fill="none" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      {pts.map((p) => (
        <g key={p.i}>
          <circle cx={p.x} cy={p.y} r="4" fill="#fff" stroke={stroke} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          <text x={p.x} y={p.y - 9} textAnchor="middle" fontSize="11" fill="var(--hc-text-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>{p.v}{unit}</text>
        </g>
      ))}
    </svg>
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

function MonthAxis({ series }: { series: MonthSummary[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${series.length}, 1fr)`, marginTop: 7 }}>
      {series.map((s) => (
        <div key={`${s.year}-${s.month}`} style={{ fontSize: 10, color: "var(--hc-text-faint)", textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{label(s)}</div>
      ))}
    </div>
  );
}

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

  // union of habit names across months, in first-seen order
  const habitNames = useMemo(() => {
    const seen: string[] = [];
    for (const s of series ?? []) for (const h of s.perHabit) if (!seen.includes(h.name)) seen.push(h.name);
    return seen;
  }, [series]);

  if (err) return <p style={{ color: "var(--hc-flag-text)" }}>{err}</p>;
  if (!series) return <p style={{ color: "var(--hc-text-muted)" }}>loading…</p>;
  if (series.length === 0) return <p style={{ color: "var(--hc-text-muted)" }}>No months yet. Import one from the Import tab.</p>;

  const sleepVals = series.map((s) => s.meanSleep);
  const hasSleep = sleepVals.some((v) => v !== null);
  const sleepMax = Math.max(10, ...sleepVals.filter((v): v is number => v !== null));
  const pctByHabit = (name: string, s: MonthSummary) => s.perHabit.find((h) => h.name === name)?.pct ?? null;

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
        <MiniLine values={series.map((s) => s.completion)} vmax={100} unit="%" stroke="var(--hc-done)" />
        <MonthAxis series={series} />
      </ChartCard>

      {hasSleep && (
        <ChartCard title="Mean sleep" sub="Average hours per night, per month (months with no sleep logged are skipped)">
          <MiniLine values={sleepVals} vmax={sleepMax} unit="h" stroke="var(--hc-sleep)" />
          <MonthAxis series={series} />
        </ChartCard>
      )}

      <ChartCard title="Per-habit completion" sub="Each habit's monthly completion %; blank where the habit wasn't tracked that month">
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 4, width: "100%", minWidth: 320 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", fontSize: 11.5, fontWeight: 700, color: "var(--hc-text-muted)", padding: "0 8px" }} />
                {series.map((s) => (
                  <th key={`${s.year}-${s.month}`} style={{ fontSize: 11, fontWeight: 700, color: "var(--hc-text-muted)", textAlign: "center", fontVariantNumeric: "tabular-nums", minWidth: 44 }}>{label(s)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {habitNames.map((name) => (
                <tr key={name}>
                  <td style={{ fontSize: 12, fontWeight: 500, color: "var(--hc-text-body)", padding: "0 8px", whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }} title={name}>{name}</td>
                  {series.map((s) => {
                    const p = pctByHabit(name, s);
                    const { bg, color } = heat(p);
                    return (
                      <td key={`${s.year}-${s.month}`} style={{ textAlign: "center", fontSize: 11.5, fontVariantNumeric: "tabular-nums", fontWeight: 700, color, background: bg, borderRadius: 6, height: 26 }}>
                        {p === null ? "" : `${p}%`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}
