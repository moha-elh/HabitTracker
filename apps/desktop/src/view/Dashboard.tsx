// View — the dashboard: month selector + the MonthPanel (stat cards, heatmap, totals/sleep
// chart, selected-day rail). All numbers come from model/analytics; this file only renders.
import { useEffect, useMemo, useState } from "react";
import { fetchMonth, fetchMonths } from "../model/api";
import type { MonthData, MonthItem } from "../model/types";
import { buildMatrix, monthStats } from "../model/analytics";
import { CARD, LABEL, METRIC, MON3, MONTHS, PANEL, WD, inputStyle } from "./theme";

const msg = (e: unknown) => String(e instanceof Error ? e.message : e);

export function DashboardView() {
  const [months, setMonths] = useState<MonthItem[] | null>(null);
  const [sel, setSel] = useState<{ year: number; month: number } | null>(null);
  const [data, setData] = useState<MonthData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await fetchMonths();
        setMonths(list);
        if (list.length) setSel({ year: list[0].year, month: list[0].month });
      } catch (e) { setErr(msg(e)); }
    })();
  }, []);

  useEffect(() => {
    if (!sel) return;
    setData(null);
    (async () => {
      try { setData(await fetchMonth(sel.year, sel.month)); }
      catch (e) { setErr(msg(e)); }
    })();
  }, [sel]);

  if (err) return <p style={{ color: "var(--hc-flag-text)" }}>{err}</p>;
  if (months && months.length === 0) return <p style={{ color: "var(--hc-text-muted)" }}>No months yet — import one from the Import tab.</p>;
  if (!months || !sel) return <p style={{ color: "var(--hc-text-muted)" }}>loading…</p>;

  const item = months.find((m) => m.year === sel.year && m.month === sel.month);
  const imported = item ? new Date(item.imported_at) : null;

  return (
    <div style={{ width: "100%", display: "grid", gap: 14, textAlign: "left" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--hc-text-label)", fontWeight: 700, marginBottom: 6 }}>Habit Chronicle</div>
          <div style={{ fontSize: 46, fontWeight: 400, lineHeight: 1, fontFamily: "var(--hc-font-display)" }}>{MONTHS[sel.month - 1]} {sel.year}</div>
          <div style={{ fontSize: 13, color: "var(--hc-text-muted)", marginTop: 8 }}>
            {imported ? `Imported ${imported.getDate()} ${MON3[imported.getMonth()]} ${imported.getFullYear()} · ` : ""}
            {data ? `${data.habits.length} habits · ${data.days} days` : "loading…"}
          </div>
        </div>
        <select style={{ ...inputStyle, fontSize: 13, fontWeight: 700, borderRadius: 10, padding: "9px 14px", cursor: "pointer" }}
          value={`${sel.year}-${sel.month}`}
          onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); setSel({ year: y, month: m }); }}>
          {months.map((m) => (
            <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>{MONTHS[m.month - 1]} {m.year}</option>
          ))}
        </select>
      </div>

      {data ? <MonthPanel key={`${data.year}-${data.month}`} data={data} /> : <p style={{ color: "var(--hc-text-muted)" }}>loading…</p>}
    </div>
  );
}

function MonthPanel({ data }: { data: MonthData }) {
  const { days, habits, year, month } = data;
  const status = useMemo(() => buildMatrix(data), [data]);
  const s = useMemo(() => monthStats(data, status), [data, status]);
  const [selDay, setSelDay] = useState<number>(s.bestDay);

  const dateLong = (day: number) => `${WD[new Date(year, month - 1, day).getDay()]} ${day} ${MONTHS[month - 1]}`;

  // chart geometry (presentation math over the computed dayTotals / sleep)
  const X = (i: number) => (days > 1 ? (i / (days - 1)) * 600 : 300);
  const maxH = Math.max(1, habits.length);
  const YT = (v: number) => 169 - (v / maxH) * 168;
  const totalLine = "M" + s.dayTotals.map((t, i) => `${X(i).toFixed(1)},${YT(t).toFixed(1)}`).join("L");
  const totalArea = `${totalLine}L${X(days - 1).toFixed(1)},169L${X(0).toFixed(1)},169Z`;
  let sleepLine = "";
  if (s.hasSleep) {
    const hrs = data.sleep.map((x) => x.hours);
    const lo = Math.floor(Math.min(...hrs) - 0.5), hi = Math.ceil(Math.max(...hrs) + 0.5);
    const YS = (v: number) => (hi > lo ? 169 - ((v - lo) / (hi - lo)) * 168 : 85);
    sleepLine = "M" + [...data.sleep].sort((a, b) => a.day - b.day).map((x) => `${X(x.day - 1).toFixed(1)},${YS(x.hours).toFixed(1)}`).join("L");
  }
  const selX = X(selDay - 1), selY = YT(s.dayTotals[selDay - 1]);

  const legendDot = (c: string, label: string) => (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 11, height: 11, borderRadius: 3, background: c, display: "block" }} />{label}
    </span>
  );

  return (
    <div style={{ display: "grid", gap: 14, width: "100%" }}>
      {/* ---- stat cards ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        <div style={CARD}>
          <div style={LABEL}>Completion</div>
          <div style={{ marginTop: 10 }}><span style={METRIC}>{s.monthly}%</span></div>
          <div style={{ height: 6, borderRadius: 3, background: "var(--hc-rule)", marginTop: 12, overflow: "hidden" }}>
            <div style={{ width: `${s.monthly}%`, height: "100%", background: "var(--hc-done)", borderRadius: 3 }} />
          </div>
          <div style={{ fontSize: 11.5, color: "var(--hc-text-faint)", marginTop: 8 }}>{s.done} of {s.done + s.missed} cells green</div>
        </div>
        <div style={CARD}>
          <div style={LABEL}>Longest streak</div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={METRIC}>{s.best.run.len}</span><span style={{ fontSize: 13, color: "var(--hc-text-muted)" }}>days</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--hc-text-body)", marginTop: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.best.run.len ? s.best.name : "—"}</div>
          <div style={{ fontSize: 11.5, color: "var(--hc-text-faint)", marginTop: 4 }}>{s.best.run.len ? `${s.best.run.start} → ${s.best.run.end} ${MON3[month - 1]}` : "no streak yet"}</div>
        </div>
        <div style={CARD}>
          <div style={LABEL}>Mean sleep</div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={METRIC}>{s.hasSleep ? s.meanSleep.toFixed(1) : "—"}</span><span style={{ fontSize: 13, color: "var(--hc-text-muted)" }}>h / night</span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--hc-text-faint)", marginTop: 12 }}>
            {s.hasSleep && s.minSleep ? `σ ${s.sdSleep.toFixed(1)} · shortest ${s.minSleep.hours}h on ${s.minSleep.day} ${MON3[month - 1]}` : "no sleep logged yet"}
          </div>
        </div>
        <div style={CARD}>
          <div style={LABEL}>Best day</div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={METRIC}>{s.hasTracked ? s.dayTotals[s.bestDay - 1] : 0}</span><span style={{ fontSize: 13, color: "var(--hc-text-muted)" }}>of {habits.length} habits</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--hc-text-body)", marginTop: 12, fontWeight: 700 }}>{s.hasTracked ? dateLong(s.bestDay) : "—"}</div>
          <div style={{ fontSize: 11.5, color: "var(--hc-text-faint)", marginTop: 4 }}>{s.hasTracked ? `Worst: ${s.worstDay} ${MON3[month - 1]} — ${s.dayTotals[s.worstDay - 1]} habit(s)` : ""}</div>
        </div>
      </div>

      {/* ---- main: grid + chart | selected-day rail ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 336px", gap: 14, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {/* grid card */}
          <div style={{ ...PANEL, padding: "20px 22px 22px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.01em" }}>The grid</div>
                <div style={{ fontSize: 11.5, color: "var(--hc-text-faint)", marginTop: 3 }}>Click a day to read that day</div>
              </div>
              <div style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 11.5, color: "var(--hc-text-muted)" }}>
                {legendDot("var(--hc-done)", "done")}
                {legendDot("var(--hc-missed)", "missed")}
                {legendDot("var(--hc-surface-sunk)", "empty")}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ width: 132, flex: "none", paddingTop: 20, display: "flex", flexDirection: "column", gap: 5 }}>
                {s.perHabit.map((h) => (
                  <div key={h.name} style={{ height: 19, display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--hc-text-body)", fontWeight: 500 }} title={h.name}>{h.name}</span>
                    <span style={{ fontSize: 10, color: "var(--hc-text-faint)", fontVariantNumeric: "tabular-nums" }}>{h.pct === null ? "" : `${h.pct}%`}</span>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${days}, 1fr)`, gap: 3, marginBottom: 5 }}>
                  {Array.from({ length: days }, (_, d) => {
                    const isSel = d + 1 === selDay;
                    return (
                      <div key={d} onClick={() => setSelDay(d + 1)} title={`day ${d + 1}`}
                        style={{ fontSize: 8.5, textAlign: "center", height: 15, lineHeight: "15px", borderRadius: 4, cursor: "pointer", fontVariantNumeric: "tabular-nums",
                          color: isSel ? "#fff" : "var(--hc-text-faint)", background: isSel ? "var(--hc-surface-ink)" : "transparent", fontWeight: isSel ? 700 : 500 }}>
                        {d + 1}
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {status.map((row, r) => (
                    <div key={r} style={{ display: "grid", gridTemplateColumns: `repeat(${days}, 1fr)`, gap: 3, height: 19 }}>
                      {row.map((st, d) => {
                        const isSel = d + 1 === selDay;
                        const bg = st === "done" ? (isSel ? "var(--hc-done-deep)" : "var(--hc-done)")
                          : st === "missed" ? (isSel ? "var(--hc-missed-deep)" : "var(--hc-missed)")
                            : "var(--hc-surface-sunk)";
                        return (
                          <div key={d} onClick={() => setSelDay(d + 1)} title={`${habits[r].name} · day ${d + 1}: ${st}`}
                            style={{ borderRadius: 4, cursor: "pointer", background: bg, boxShadow: isSel ? "var(--hc-ring-select)" : "none" }} />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* daily totals & sleep chart */}
          <div style={{ ...PANEL, padding: "20px 22px 18px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.01em" }}>Daily totals &amp; sleep</div>
                <div style={{ fontSize: 11.5, color: "var(--hc-text-faint)", marginTop: 3 }}>Habits completed per day, computed from the grid{s.hasSleep ? ", against hours slept" : ""}</div>
              </div>
              <div style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 11.5, color: "var(--hc-text-muted)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 3, borderRadius: 2, background: "var(--hc-done)", display: "block" }} />habits / day</span>
                {s.hasSleep && <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 3, borderRadius: 2, background: "var(--hc-sleep)", display: "block" }} />sleep</span>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ width: 22, flex: "none", display: "flex", flexDirection: "column", justifyContent: "space-between", height: 170, fontSize: 9.5, color: "var(--hc-text-faint)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                <span>{maxH}</span><span>{Math.round(maxH * 2 / 3)}</span><span>{Math.round(maxH / 3)}</span><span>0</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <svg viewBox="0 0 600 170" preserveAspectRatio="none" style={{ width: "100%", height: 170, display: "block", overflow: "visible" }}>
                  {[1, 57, 113].map((y) => <line key={y} x1="0" y1={y} x2="600" y2={y} stroke="var(--hc-rule)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
                  <line x1="0" y1="169" x2="600" y2="169" stroke="#e5ddd1" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <line x1={selX} y1="0" x2={selX} y2="170" stroke="#e8c8a8" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                  <path d={totalArea} fill="var(--hc-done)" fillOpacity="0.13" />
                  <path d={totalLine} fill="none" stroke="var(--hc-done)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  {s.hasSleep && <path d={sleepLine} fill="none" stroke="var(--hc-sleep)" strokeWidth="1.8" strokeDasharray="5 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
                  <circle cx={selX} cy={selY} r="4.5" fill="#fff" stroke="var(--hc-done)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                </svg>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${days}, 1fr)`, marginTop: 7 }}>
                  {Array.from({ length: days }, (_, d) => (
                    <div key={d} style={{ fontSize: 8.5, color: "var(--hc-text-faint)", textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                      {(d + 1) % 5 === 0 || d === 0 ? d + 1 : ""}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* selected-day rail */}
        <div style={{ ...PANEL, padding: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 26, fontWeight: 400, fontFamily: "var(--hc-font-display)" }}>{dateLong(selDay)}</div>
            <div style={{ fontSize: 11.5, color: "var(--hc-text-faint)", whiteSpace: "nowrap" }}>day {selDay} of {days}</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <div style={{ flex: 1, background: "var(--hc-surface-sunk)", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--hc-text-faint)", fontWeight: 700 }}>Habits</div>
              <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4 }}>{s.dayTotals[selDay - 1]}<span style={{ fontSize: 12, color: "var(--hc-text-faint)", fontWeight: 600 }}> / {habits.length}</span></div>
            </div>
            <div style={{ flex: 1, background: "var(--hc-surface-sunk)", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--hc-text-faint)", fontWeight: 700 }}>Sleep</div>
              <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4 }}>{s.sleepByDay.has(selDay) ? s.sleepByDay.get(selDay) : "—"}<span style={{ fontSize: 12, color: "var(--hc-text-faint)", fontWeight: 600 }}>h</span></div>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--hc-text-faint)", fontWeight: 700, marginBottom: 8 }}>Memorable moment</div>
            <div style={{ fontSize: 15, lineHeight: 1.5, color: "var(--hc-text)" }}>{s.momentByDay.get(selDay) ?? <span style={{ color: "var(--hc-text-faint)" }}>No line recorded for this day.</span>}</div>
          </div>
          <div style={{ marginTop: 18, borderTop: "1px solid var(--hc-rule)", paddingTop: 14 }}>
            <div style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--hc-text-faint)", fontWeight: 700, marginBottom: 10 }}>That day</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {habits.filter((_, r) => status[r][selDay - 1] === "done").map((h) => (
                <div key={h.name} style={{ fontSize: 11.5, background: "var(--hc-done-tint)", color: "var(--hc-done-text)", borderRadius: 20, padding: "5px 11px" }}>{h.name}</div>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {habits.filter((_, r) => status[r][selDay - 1] === "missed").map((h) => (
                <div key={h.name} style={{ fontSize: 11.5, background: "var(--hc-missed-tint)", color: "var(--hc-missed-text)", borderRadius: 20, padding: "5px 11px" }}>{h.name}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
