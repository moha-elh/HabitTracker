// View — the dashboard: month selector + the MonthPanel (stat cards, heatmap, totals/sleep
// chart, selected-day rail). All numbers come from model/analytics; this file only renders.
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchMonth, fetchMonthImages, fetchMonthReview, fetchMonths, saveConfetti } from "../model/api";
import type { MonthData, MonthItem } from "../model/types";
import { buildMatrix, monthStats, type MonthStats } from "../model/analytics";
import { CARD, LABEL, METRIC, MON3, MONTHS, PANEL, WD, btnStyle, inputStyle, secondaryBtn } from "./theme";

const msg = (e: unknown) => String(e instanceof Error ? e.message : e);

export function DashboardView() {
  const [months, setMonths] = useState<MonthItem[] | null>(null);
  const [sel, setSel] = useState<{ year: number; month: number } | null>(null);
  const [data, setData] = useState<MonthData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showImages, setShowImages] = useState(false);

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
  if (months && months.length === 0) return <p style={{ color: "var(--hc-text-muted)" }}>No months yet. Import one from the Import tab.</p>;
  if (!months || !sel) return <p style={{ color: "var(--hc-text-muted)" }}>loading…</p>;

  const item = months.find((m) => m.year === sel.year && m.month === sel.month);
  const imported = item ? new Date(item.imported_at) : null;

  return (
    <div style={{ width: "100%", display: "grid", gap: 14, textAlign: "left" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--hc-text-label)", fontWeight: 700, marginBottom: 6 }}>Habit Chronicle</div>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <select style={{ ...inputStyle, fontSize: 20, fontWeight: 700, borderRadius: 10, padding: "8px 16px", cursor: "pointer", textAlign: "center", textAlignLast: "center", fontFamily: "var(--hc-font-display)" }}
            value={`${sel.year}-${sel.month}`}
            onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); setSel({ year: y, month: m }); }}>
            {months.map((m) => (
              <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>{MONTHS[m.month - 1]} {m.year}</option>
            ))}
          </select>
          <button style={{ ...secondaryBtn, padding: "8px 14px", fontSize: 12.5 }} onClick={() => setShowImages(true)}>View source images</button>
        </div>
        <div style={{ fontSize: 13, color: "var(--hc-text-muted)", marginTop: 8 }}>
          {imported ? `Imported ${imported.getDate()} ${MON3[imported.getMonth()]} ${imported.getFullYear()} · ` : ""}
          {data ? `${data.habits.length} habits · ${data.days} days` : "loading…"}
        </div>
      </div>

      {data ? <MonthPanel key={`${data.year}-${data.month}`} data={data} /> : <p style={{ color: "var(--hc-text-muted)" }}>loading…</p>}
      {showImages && <ImagesModal year={sel.year} month={sel.month} onClose={() => setShowImages(false)} />}
    </div>
  );
}

/** Popup showing the archived source photos (habit grid + memorable moments) for a month. */
function ImagesModal({ year, month, onClose }: { year: number; month: number; onClose: () => void }) {
  const [imgs, setImgs] = useState<{ grid: string | null; moments: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try { setImgs(await fetchMonthImages(year, month)); }
      catch (e) { setErr(msg(e)); }
    })();
  }, [year, month]);

  const cap: React.CSSProperties = { fontSize: 12, color: "#f4ede3", marginTop: 8, textAlign: "center" };
  const img: React.CSSProperties = { maxHeight: "72vh", maxWidth: "44vw", borderRadius: 10, display: "block", border: "1px solid rgba(255,255,255,0.15)" };
  const none = (label: string) => <div style={{ color: "#cdbfae", fontSize: 13, padding: "40px 20px" }}>No {label} photo stored.</div>;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,0.78)", zIndex: 60, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 22, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "center" }}>
        {err ? <div style={{ color: "#f4ede3", fontSize: 14 }}>No stored images for {MONTHS[month - 1]} {year} (committed before image archiving).</div>
          : !imgs ? <div style={{ color: "#f4ede3" }}>loading…</div>
            : (
              <>
                <figure style={{ margin: 0 }}>{imgs.grid ? <img src={imgs.grid} alt="habit grid" style={img} /> : none("habit grid")}<figcaption style={cap}>Habit grid</figcaption></figure>
                <figure style={{ margin: 0 }}>{imgs.moments ? <img src={imgs.moments} alt="memorable moments" style={img} /> : none("memorable moments")}<figcaption style={cap}>Memorable moments</figcaption></figure>
              </>
            )}
      </div>
      <button onClick={onClose} style={{ background: "var(--hc-surface)", color: "var(--hc-text)", border: "1px solid var(--hc-border-strong)", borderRadius: 8, padding: "6px 16px", fontFamily: "var(--hc-font-body)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Close</button>
    </div>
  );
}

/** Tiny inline line chart (no axes) for a stat card. Needs 2+ points. */
function Sparkline({ values, stroke }: { values: number[]; stroke: string }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  const X = (i: number) => (i / (values.length - 1)) * 100;
  const Y = (v: number) => (hi > lo ? 22 - ((v - lo) / (hi - lo)) * 20 : 12);
  const d = "M" + values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("L");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{ width: "100%", height: 24, display: "block" }}>
      <path d={d} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MonthPanel({ data }: { data: MonthData }) {
  const { days, habits, year, month } = data;
  const status = useMemo(() => buildMatrix(data), [data]);
  const s = useMemo(() => monthStats(data, status), [data, status]);
  const [selDay, setSelDay] = useState<number>(s.bestDay);
  const [showInsights, setShowInsights] = useState(false);
  // Hold the review in state so, once generated/loaded this session, reopening the page reuses it
  // (no refetch, no chance of a fresh summary) and the dashboard card reflects it live.
  const [review, setReview] = useState<string | null>(data.review);
  const sleepSeries = useMemo(() => [...data.sleep].sort((a, b) => a.day - b.day).map((x) => x.hours), [data.sleep]);

  // Month is shown in the header, so the day rail/cards need only weekday + day (one line).
  const dateShort = (day: number) => `${WD[new Date(year, month - 1, day).getDay()]} ${day}`;
  const maxSleep = sleepSeries.length ? Math.max(...sleepSeries) : 0;

  // chart geometry: X puts each day at the CENTER of its column (i+0.5)/days, matching the
  // grid's repeat(days,1fr) columns above, so grid and chart align day-for-day.
  const X = (i: number) => ((i + 0.5) / days) * 600;
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
        <div style={{ ...CARD, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={LABEL}>Completion</div>
          <div style={{ marginTop: 10 }}><span style={METRIC}>{s.monthly}%</span></div>
          <div style={{ height: 6, borderRadius: 3, background: "var(--hc-rule)", marginTop: 12, overflow: "hidden" }}>
            <div style={{ width: `${s.monthly}%`, height: "100%", background: "var(--hc-done)", borderRadius: 3 }} />
          </div>
          <div style={{ fontSize: 12.5, color: "var(--hc-text-muted)", fontWeight: 500, marginTop: 8 }}>{s.done} of {s.done + s.missed} cells green</div>
        </div>
        <div style={{ ...CARD, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={LABEL}>Longest streak</div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={METRIC}>{s.best.run.len}</span><span style={{ fontSize: 13, color: "var(--hc-text-muted)" }}>days</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--hc-text-body)", marginTop: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.best.run.len ? s.best.name : "·"}</div>
          <div style={{ fontSize: 12.5, color: "var(--hc-text-muted)", fontWeight: 500, marginTop: 4 }}>{s.best.run.len ? `${s.best.run.start} → ${s.best.run.end} ${MON3[month - 1]}` : "no streak yet"}</div>
        </div>
        <div style={{ ...CARD, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={LABEL}>Mean sleep</div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={METRIC}>{s.hasSleep ? s.meanSleep.toFixed(1) : "·"}</span><span style={{ fontSize: 13, color: "var(--hc-text-muted)" }}>h / night</span>
          </div>
          {s.hasSleep && sleepSeries.length > 1 && (
            <div style={{ marginTop: 10 }}><Sparkline values={sleepSeries} stroke="var(--hc-sleep)" /></div>
          )}
          <div style={{ fontSize: 12.5, color: "var(--hc-text-muted)", fontWeight: 500, marginTop: 12 }}>
            {s.hasSleep && s.minSleep ? `${sleepSeries.length} nights logged · ${s.minSleep.hours}h shortest, ${maxSleep}h longest` : "no sleep logged yet"}
          </div>
        </div>
        <div style={{ ...CARD, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={LABEL}>Best day</div>
          <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-.01em", marginTop: 10, lineHeight: 1.1, whiteSpace: "nowrap" }}>{s.hasTracked ? dateShort(s.bestDay) : "·"}</div>
          <div style={{ marginTop: 6, display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 20, fontWeight: 900 }}>{s.hasTracked ? s.dayTotals[s.bestDay - 1] : 0}</span>
            <span style={{ fontSize: 13, color: "var(--hc-text-muted)" }}>of {habits.length} habits that day</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--hc-text-muted)", fontWeight: 500, marginTop: 10 }}>{s.hasTracked ? `Worst: ${dateShort(s.worstDay)} · ${s.dayTotals[s.worstDay - 1]} habit(s)` : ""}</div>
        </div>
      </div>

      {/* ---- main: [grid over chart] | [day rail over review] ---- stretch so the review card's
           bottom lines up with the chart card's bottom (the review card grows to fill) ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 336px", gap: 14, alignItems: "stretch" }}>
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
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${days}, 1fr)`, marginBottom: 5 }}>
                  {Array.from({ length: days }, (_, d) => {
                    const isSel = d + 1 === selDay;
                    return (
                      <div key={d} onClick={() => setSelDay(d + 1)} title={`day ${d + 1}`}
                        style={{ fontSize: 8.5, textAlign: "center", height: 15, lineHeight: "15px", borderRadius: 4, cursor: "pointer", fontVariantNumeric: "tabular-nums", margin: "0 1.5px",
                          color: isSel ? "#fff" : "var(--hc-text-faint)", background: isSel ? "var(--hc-surface-ink)" : "transparent", fontWeight: isSel ? 700 : 500 }}>
                        {d + 1}
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {status.map((row, r) => (
                    // gap lives in each tile's horizontal margin (not grid gap) so columns stay
                    // uniform 1fr and line up exactly with the chart's day positions below.
                    <div key={r} style={{ display: "grid", gridTemplateColumns: `repeat(${days}, 1fr)`, height: 19 }}>
                      {row.map((st, d) => {
                        const isSel = d + 1 === selDay;
                        const bg = st === "done" ? (isSel ? "var(--hc-done-deep)" : "var(--hc-done)")
                          : st === "missed" ? (isSel ? "var(--hc-missed-deep)" : "var(--hc-missed)")
                            : "var(--hc-surface-sunk)";
                        return (
                          <div key={d} onClick={() => setSelDay(d + 1)} title={`${habits[r].name} · day ${d + 1}: ${st}`}
                            style={{ borderRadius: 4, cursor: "pointer", background: bg, margin: "0 1.5px", boxShadow: isSel ? "var(--hc-ring-select)" : "none" }} />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* confetti card | daily totals & sleep chart. The left card fills the aligned zone:
              92 + 14 gap + 22 chart pad + 26 y-axis + 10 gap = 164 = the grid's 22 pad + 132 label + 10 gap,
              so the chart's day columns still line up under the grid's. */}
          <div style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
          <ConfettiButton year={year} month={month} initial={data.confetti} />
          <div style={{ ...PANEL, padding: "20px 22px 18px", flex: 1, minWidth: 0 }}>
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
              <div style={{ width: 26, flex: "none", display: "flex", flexDirection: "column", justifyContent: "space-between", height: 170, fontSize: 9.5, color: "var(--hc-text-faint)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                <span>{maxH}</span><span>{Math.round(maxH * 2 / 3)}</span><span>{Math.round(maxH / 3)}</span><span>0</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ position: "relative" }}>
                  <svg viewBox="0 0 600 170" preserveAspectRatio="none" style={{ width: "100%", height: 170, display: "block", overflow: "visible" }}>
                    {[1, 57, 113].map((y) => <line key={y} x1="0" y1={y} x2="600" y2={y} stroke="var(--hc-rule)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
                    <line x1="0" y1="169" x2="600" y2="169" stroke="#e5ddd1" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    <line x1={selX} y1="0" x2={selX} y2="170" stroke="#e8c8a8" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                    <path d={totalArea} fill="var(--hc-done)" fillOpacity="0.13" />
                    <path d={totalLine} fill="none" stroke="var(--hc-done)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                    {s.hasSleep && <path d={sleepLine} fill="none" stroke="var(--hc-sleep)" strokeWidth="1.8" strokeDasharray="5 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
                    <circle cx={selX} cy={selY} r="4.5" fill="#fff" stroke="var(--hc-done)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                  </svg>
                  {/* transparent day columns over the chart: click to select that day (syncs with the grid) */}
                  <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: `repeat(${days}, 1fr)` }}>
                    {Array.from({ length: days }, (_, d) => (
                      <div key={d} onClick={() => setSelDay(d + 1)} title={`day ${d + 1}`} style={{ cursor: "pointer" }} />
                    ))}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${days}, 1fr)`, marginTop: 7 }}>
                  {Array.from({ length: days }, (_, d) => (
                    <div key={d} onClick={() => setSelDay(d + 1)} style={{ fontSize: 8.5, color: d + 1 === selDay ? "var(--hc-text)" : "var(--hc-text-faint)", fontWeight: d + 1 === selDay ? 700 : 500, textAlign: "center", fontVariantNumeric: "tabular-nums", cursor: "pointer" }}>
                      {(d + 1) % 5 === 0 || d === 0 || d + 1 === selDay ? d + 1 : ""}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>

        {/* right column: the selected day, then the review */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* selected-day rail */}
        <div style={{ ...PANEL, padding: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 26, fontWeight: 400, fontFamily: "var(--hc-font-display)", whiteSpace: "nowrap" }}>{dateShort(selDay)}</div>
            <div style={{ fontSize: 11.5, color: "var(--hc-text-faint)", whiteSpace: "nowrap" }}>day {selDay} of {days}</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <div style={{ flex: 1, background: "var(--hc-surface-sunk)", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--hc-text-faint)", fontWeight: 700 }}>Habits</div>
              <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4 }}>{s.dayTotals[selDay - 1]}<span style={{ fontSize: 12, color: "var(--hc-text-faint)", fontWeight: 600 }}> / {habits.length}</span></div>
            </div>
            <div style={{ flex: 1, background: "var(--hc-surface-sunk)", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--hc-text-faint)", fontWeight: 700 }}>Sleep</div>
              <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4 }}>{s.sleepByDay.has(selDay) ? s.sleepByDay.get(selDay) : "·"}<span style={{ fontSize: 12, color: "var(--hc-text-faint)", fontWeight: 600 }}>h</span></div>
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

        {/* monthly review launcher: opens the full insights page (grows to align with the chart) */}
        <MonthReview review={review} onOpen={() => setShowInsights(true)} />
        </div>
      </div>

      {showInsights && <InsightsPage data={data} s={s} review={review} onReviewed={setReview} onClose={() => setShowInsights(false)} />}
    </div>
  );
}

/** Launcher card: shows the cached AI opener (persistent, no call on load) and opens the full
 * insights page. Content is kept compact so the card's bottom lines up with the chart card. */
function MonthReview({ review, onOpen }: { review: string | null; onOpen: () => void }) {
  const opener = review ? reviewOpener(review) : null;
  return (
    <div style={{ ...PANEL, padding: 22, flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.01em" }}>Monthly review</div>
        <div style={{ fontSize: 11.5, color: "var(--hc-text-faint)", marginTop: 3 }}>An AI look at your month, with tips for the next one</div>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.55, color: opener ? "var(--hc-text-body)" : "var(--hc-text-faint)" }}>
        {opener ?? "Open analytics to generate your AI review and get advice for next month."}
      </div>
      <button onClick={onOpen} style={{ ...btnStyle, width: "100%" }}>View analytics</button>
    </div>
  );
}

/** First non-empty line of the review markdown (the warm opener), stripped of bold/bullet marks. */
function reviewOpener(md: string): string {
  for (const raw of md.split("\n")) {
    const line = raw.replace(/\*\*/g, "").replace(/^#{1,6}\s+/, "").replace(/^[-*]\s+/, "").trim();
    if (line) return line;
  }
  return "";
}

/** Full-screen monthly insights: detailed analytics computed from the grid, plus the AI review
 * (fetched on open). Reuses the same monthStats the dashboard panel shows. */
function InsightsPage({ data, s, review, onReviewed, onClose }: { data: MonthData; s: MonthStats; review: string | null; onReviewed: (text: string) => void; onClose: () => void }) {
  const { year, month, habits, days } = data;
  const tracked = s.done + s.missed;
  const activeDays = s.dayTotals.filter((t) => t > 0).length;
  const ranked = [...s.perHabit].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  const sleepSeries = [...data.sleep].sort((a, b) => a.day - b.day).map((x) => x.hours);
  const maxSleep = sleepSeries.length ? Math.max(...sleepSeries) : 0;
  const minSleepVal = sleepSeries.length ? Math.min(...sleepSeries) : 0;
  const dateShort = (day: number) => `${WD[new Date(year, month - 1, day).getDay()]} ${day}`;
  // Correlation between a night's sleep and that day's habits done (the headline data insight).
  const sleepCorr = pearson(data.sleep.map((x) => x.hours), data.sleep.map((x) => s.dayTotals[x.day - 1]));

  type S = { v: "loading" } | { v: "done"; text: string } | { v: "error"; msg: string };
  // Seed from the review already held for this month (no call); otherwise fetch it once (the server
  // returns its cached copy, or generates + caches). Redo forces a fresh generation. Every result
  // is lifted up via onReviewed so it is remembered and never regenerated on reopen.
  const [rev, setRev] = useState<S>(review ? { v: "done", text: review } : { v: "loading" });
  async function loadReview(refresh: boolean) {
    setRev({ v: "loading" });
    try {
      const text = await fetchMonthReview(year, month, refresh);
      setRev({ v: "done", text });
      onReviewed(text);
    } catch (e) { setRev({ v: "error", msg: msg(e) }); }
  }
  useEffect(() => { if (!review) loadReview(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stat = (label: string, value: React.ReactNode, sub?: string) => (
    <div style={{ ...CARD, minWidth: 0 }}>
      <div style={LABEL}>{label}</div>
      <div style={{ ...METRIC, marginTop: 8 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--hc-text-muted)", fontWeight: 500, marginTop: 6 }}>{sub}</div>}
    </div>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,0.55)", zIndex: 70, overflowY: "auto", padding: "40px 20px", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 860, background: "var(--hc-bg)", borderRadius: 20, border: "1px solid var(--hc-border)", padding: "28px 30px 34px", boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--hc-text-label)", fontWeight: 700 }}>Monthly insights</div>
            <div style={{ fontFamily: "var(--hc-font-display)", fontSize: 38, fontWeight: 400, lineHeight: 1.1, marginTop: 4 }}>{MONTHS[month - 1]} {year}</div>
          </div>
          <button onClick={onClose} style={{ ...secondaryBtn, padding: "7px 16px", fontSize: 13 }}>Close</button>
        </div>

        {/* headline stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 22 }}>
          {stat("Completion", `${s.monthly}%`, `${s.done} of ${tracked} cells done`)}
          {stat("Active days", `${activeDays}`, `of ${days} days had a habit`)}
          {stat("Longest streak", `${s.best.run.len}`, s.best.run.len ? s.best.name : "no streak yet")}
          {stat("Mean sleep", s.hasSleep ? `${s.meanSleep.toFixed(1)}h` : "·", s.hasSleep ? `${minSleepVal}h to ${maxSleep}h` : "no sleep logged")}
        </div>

        {/* AI review */}
        <div style={{ ...PANEL, padding: "20px 22px", marginTop: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>AI review &amp; advice ✨</div>
            {rev.v !== "loading" && <button onClick={() => loadReview(true)} style={{ ...secondaryBtn, padding: "5px 10px", fontSize: 11.5 }}>Redo</button>}
          </div>
          {rev.v === "loading" && <div style={{ marginTop: 12, fontSize: 13, color: "var(--hc-text-muted)" }}>Reading your month and writing advice…</div>}
          {rev.v === "error" && <div style={{ marginTop: 12, fontSize: 13, color: "var(--hc-flag-text)" }}>{rev.msg}</div>}
          {rev.v === "done" && <div style={{ marginTop: 10 }}>{renderReview(rev.text)}</div>}
        </div>

        {/* habit breakdown */}
        <div style={{ ...PANEL, padding: "20px 22px", marginTop: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Every habit, best to worst</div>
          <div style={{ fontSize: 11.5, color: "var(--hc-text-faint)", marginBottom: 16 }}>Completion for the month and the longest run of consecutive days</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {ranked.map((h) => (
              <div key={h.name} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 150, flex: "none", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--hc-text-body)", fontWeight: 500 }} title={h.name}>{h.name}</span>
                <div style={{ flex: 1, height: 9, borderRadius: 5, background: "var(--hc-rule)", overflow: "hidden" }}>
                  <div style={{ width: `${h.pct ?? 0}%`, height: "100%", background: "var(--hc-done)", borderRadius: 5 }} />
                </div>
                <span style={{ width: 40, flex: "none", textAlign: "right", fontSize: 12, color: "var(--hc-text-muted)", fontVariantNumeric: "tabular-nums" }}>{h.pct === null ? "·" : `${h.pct}%`}</span>
                <span style={{ width: 92, flex: "none", textAlign: "right", fontSize: 11, color: "var(--hc-text-faint)" }}>{h.run.len ? `${h.run.len}-day streak` : "no streak"}</span>
              </div>
            ))}
          </div>
        </div>

        {/* rhythm + sleep */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
          <div style={{ ...PANEL, padding: "20px 22px" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Your rhythm</div>
            <Line label="Strongest day" value={s.hasTracked ? `${dateShort(s.bestDay)} · ${s.dayTotals[s.bestDay - 1]} habits` : "·"} />
            <Line label="Quietest day" value={s.hasTracked ? `${dateShort(s.worstDay)} · ${s.dayTotals[s.worstDay - 1]} habits` : "·"} />
            <Line label="Best streak" value={s.best.run.len ? `${s.best.name}, ${s.best.run.len} days (${s.best.run.start}→${s.best.run.end} ${MON3[month - 1]})` : "no streak yet"} />
            <Line label="Habits tracked" value={`${habits.length}`} last />
          </div>
          <div style={{ ...PANEL, padding: "20px 22px" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Sleep</div>
            {s.hasSleep ? (
              <>
                <Line label="Mean" value={`${s.meanSleep.toFixed(1)}h / night`} />
                <Line label="Shortest" value={s.minSleep ? `${s.minSleep.hours}h on ${dateShort(s.minSleep.day)}` : "·"} />
                <Line label="Longest" value={`${maxSleep}h`} />
                <Line label="Nights logged" value={`${sleepSeries.length} of ${days}`} />
                <Line label="Sleep vs habits" value={sleepCorr === null ? "not enough data" : `r = ${sleepCorr.toFixed(2)}`} last />
                {sleepSeries.length > 1 && <div style={{ marginTop: 14 }}><Sparkline values={sleepSeries} stroke="var(--hc-sleep)" /></div>}
                {sleepCorr !== null && (
                  <div style={{ fontSize: 12, color: "var(--hc-text-muted)", lineHeight: 1.5, marginTop: 12 }}>{corrRead(sleepCorr)}</div>
                )}
              </>
            ) : <div style={{ fontSize: 13, color: "var(--hc-text-muted)" }}>No sleep hours logged this month.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Pearson correlation, or null with fewer than 3 points or no variance. */
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Plain-language read of a sleep-vs-habits correlation. */
function corrRead(r: number): string {
  const a = Math.abs(r);
  if (a < 0.2) return "Sleep and habits done move independently this month.";
  const strength = a < 0.4 ? "A weak" : a < 0.6 ? "A moderate" : "A strong";
  return r > 0
    ? `${strength} link: nights with more sleep tend to be days you get more done.`
    : `${strength} link: more sleep tends to pair with fewer habits done (worth a closer look).`;
}

/** A label → value row for the insights panels. */
function Line({ label, value, last }: { label: string; value: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: last ? "none" : "1px solid var(--hc-rule)" }}>
      <span style={{ fontSize: 12, color: "var(--hc-text-faint)", fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 13, color: "var(--hc-text-body)", fontWeight: 500, textAlign: "right" }}>{value}</span>
    </div>
  );
}

/** Silly button: a per-month running click count (persisted, debounced), and each click rains
 * paper confetti down the screen. */
function ConfettiButton({ year, month, initial }: { year: number; month: number; initial: number }) {
  const [n, setN] = useState(initial);
  const latest = useRef(initial); // synchronous truth for rapid clicks
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function click() {
    const next = latest.current + 1;
    latest.current = next;
    setN(next);
    dropConfetti();
    if (timer.current) clearTimeout(timer.current); // one write per burst
    timer.current = setTimeout(() => { saveConfetti(year, month, latest.current).catch(() => {}); }, 600);
  }

  return (
    <button onClick={click} title="go on, click it"
      style={{ ...PANEL, width: 92, flex: "none", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", padding: 12 }}>
      <span style={{ fontSize: 30, lineHeight: 1 }}>🎉</span>
      <span style={{ fontSize: 22, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{n}</span>
      <span style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--hc-text-faint)", fontWeight: 700 }}>confetti</span>
    </button>
  );
}

const CONFETTI_COLORS = ["#7fae6b", "#e8a0a0", "#e8c8a8", "#6b9bd1", "#d4b483", "#c17f7f", "#8fbf7f"];
/** Rain ~30 paper slices from the top of the screen, cleaning each up when it lands. Uses the
 * Web Animations API so there is no CSS keyframe to register. */
function dropConfetti() {
  for (let i = 0; i < 30; i++) {
    const el = document.createElement("div");
    const w = 6 + Math.random() * 8;
    el.style.cssText = `position:fixed;top:-24px;left:${Math.random() * 100}vw;width:${w}px;height:${w * 0.45}px;` +
      `background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]};z-index:9999;pointer-events:none;border-radius:1px;will-change:transform;`;
    document.body.appendChild(el);
    const dx = (Math.random() - 0.5) * 260;
    const rot = Math.random() * 900 - 450;
    const dur = 1800 + Math.random() * 1500;
    const drop = window.innerHeight + 80;
    const anim = el.animate(
      [
        { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${drop * 0.85}px) rotate(${rot * 0.85}deg)`, opacity: 1, offset: 0.85 },
        { transform: `translate(${dx}px, ${drop}px) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: dur, easing: "cubic-bezier(.25,.6,.5,1)" },
    );
    anim.onfinish = () => el.remove();
  }
}

/** Minimal markdown-ish renderer: paragraphs, `- ` bullets, and **bold** inline. */
function renderReview(text: string) {
  const bold = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>);
  const out: React.ReactNode[] = [];
  let bullets: React.ReactNode[] = [];
  const flush = () => {
    if (!bullets.length) return;
    out.push(<ul key={`u${out.length}`} style={{ margin: "8px 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7 }}>{bullets}</ul>);
    bullets = [];
  };
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) { flush(); return; }
    const h = line.match(/^(#{1,6})\s+(.*)/); // markdown heading → a bigger, bold title
    if (h) { flush(); out.push(<div key={i} style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-.01em", margin: "16px 0 6px", color: "var(--hc-text)" }}>{bold(h[2])}</div>); return; }
    const m = line.match(/^[-*]\s+(.*)/);
    if (m) bullets.push(<li key={i} style={{ fontSize: 13, lineHeight: 1.5, color: "var(--hc-text-body)" }}>{bold(m[1])}</li>);
    else { flush(); out.push(<p key={i} style={{ fontSize: 13, lineHeight: 1.55, margin: "8px 0", color: "var(--hc-text-body)" }}>{bold(line)}</p>); }
  });
  flush();
  return out;
}
