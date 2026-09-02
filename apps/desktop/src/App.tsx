import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CONTRACT_VERSION, type CellStatus, type Extraction } from "./contract";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const CYCLE: Record<CellStatus, CellStatus> = { done: "missed", missed: "empty", empty: "done" };
const LOW_CONF = 0.6;

const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

// How much to rotate the reference image, clockwise. Change this to reorient it:
//   0 = horizontal (as captured) · 90 = vertical · 180 = upside-down · 270 = vertical (other way)
// 90 puts the handwritten habit names upright along the top with Fajr first (matching the grid).
const REF_IMAGE_ROTATION = 90;

// Rotate the reference image so it reads upright next to the editable grid. The image already
// carries the real handwritten habit names (server includes the margin), so nothing is drawn on.
function buildRef(dataUrl: string, deg: number): Promise<string> {
  const d = ((deg % 360) + 360) % 360;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const swap = d === 90 || d === 270;
      c.width = swap ? img.height : img.width;
      c.height = swap ? img.width : img.height;
      const ctx = c.getContext("2d");
      if (!ctx) return resolve(dataUrl);
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((d * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

type Draft = {
  year: number;
  month: number;
  days: number;
  habits: string[];
  status: CellStatus[][]; // [row][day-1]
  conf: number[][]; // [row][day-1]
  rectified: string; // data URL
};

type View =
  | { v: "import" }
  | { v: "loading" }
  | { v: "review"; draft: Draft }
  | { v: "committing"; draft: Draft }
  | { v: "done"; counts: { entries: number; year: number; month: number } }
  | { v: "dashboard" };

async function apiBase(): Promise<string> {
  const port = await invoke<number>("sidecar_port");
  return `http://127.0.0.1:${port}`;
}

function draftFromExtraction(ex: Extraction, rectified: string, days: number): Draft {
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
  // Default to Fajr-first: the reader reads the rotated photo top→bottom (Quit Sugar first),
  // so reverse rows to match the reference image (Fajr first). The Flip ⇅ button re-toggles
  // for a month that happens to read the other way. ponytail: heuristic default, not detection.
  habits.reverse(); status.reverse(); conf.reverse();
  return { year: ex.year, month: ex.month, days, habits, status, conf, rectified };
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((n, i) => {
    let name = n.trim() || `Habit ${i + 1}`;
    let base = name, k = 2;
    while (seen.has(name)) name = `${base} (${k++})`;
    seen.add(name);
    return name;
  });
}

function toExtraction(d: Draft): Extraction {
  const habits = uniqueNames(d.habits);
  const cells = [];
  for (let r = 0; r < habits.length; r++) {
    for (let day = 1; day <= d.days; day++) {
      const st = d.status[r][day - 1];
      if (st === "empty") continue;
      cells.push({ day, habit: habits[r], status: st, confidence: d.conf[r][day - 1] });
    }
  }
  return {
    contract_version: CONTRACT_VERSION,
    year: d.year, month: d.month,
    habits: habits.map((name, i) => ({ name, kind: "build" as const, sort_order: i })),
    cells, sleep: [], moments: [], flags: [],
  };
}

const CELL_BG: Record<CellStatus, string> = {
  done: "var(--hc-done)",
  missed: "var(--hc-missed)",
  empty: "var(--hc-surface-sunk)",
};

export default function App() {
  const [view, setView] = useState<View>({ v: "import" });
  const [file, setFile] = useState<File | null>(null);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(8);
  const [days, setDays] = useState(daysInMonth(2026, 8));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { document.body.style.background = "var(--hc-bg)"; }, []);
  useEffect(() => { setDays(daysInMonth(year, month)); }, [year, month]);

  async function runExtract() {
    if (!file) return;
    setError(null);
    setView({ v: "loading" });
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("year", String(year));
      form.append("month", String(month));
      form.append("days", String(days));
      const res = await fetch(`${await apiBase()}/extract`, { method: "POST", body: form });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || `extract failed (${res.status})`);
      }
      const body = await res.json();
      const ex = body.extraction as Extraction;
      // reference image includes the handwritten name margin; fall back to the tight crop
      // (e.g. an older sidecar that predates reference_png_b64) so something always shows.
      const refB64 = body.reference_png_b64 || body.rectified_png_b64;
      const rectified = await buildRef(`data:image/png;base64,${refB64}`, REF_IMAGE_ROTATION);
      setView({ v: "review", draft: draftFromExtraction(ex, rectified, days) });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setView({ v: "import" });
    }
  }

  async function commit(draft: Draft) {
    setError(null);
    setView({ v: "committing", draft });
    try {
      const res = await fetch(`${await apiBase()}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toExtraction(draft)),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(JSON.stringify(detail.detail) || `commit failed (${res.status})`);
      }
      const rec = await res.json();
      setView({ v: "done", counts: { entries: rec.entries, year: rec.year, month: rec.month } });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setView({ v: "review", draft });
    }
  }

  return (
    <main style={{ minHeight: "100vh", color: "var(--hc-text)", fontFamily: "var(--hc-font-body)", display: "flex", flexDirection: "column", alignItems: "center", padding: 28, boxSizing: "border-box" }}>
      <div style={{ width: "100%", maxWidth: 1240, margin: "auto", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <h1 style={{ fontFamily: "var(--hc-font-display)", fontSize: 46, fontWeight: 400, margin: "0 0 10px", textAlign: "center" }}>
        Habit Chronicle
      </h1>

      {(view.v === "import" || view.v === "dashboard" || view.v === "done") && (
        <nav style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <button style={navBtn(view.v === "import")} onClick={() => setView({ v: "import" })}>Import</button>
          <button style={navBtn(view.v === "dashboard")} onClick={() => setView({ v: "dashboard" })}>Dashboard</button>
        </nav>
      )}

      {error && (
        <div style={{ background: "var(--hc-flag-bg)", color: "var(--hc-flag-text)", border: "1px solid var(--hc-flag-border)", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
          {error}
        </div>
      )}

      {view.v === "import" && (
        <ImportView {...{ file, setFile, year, setYear, month, setMonth, days, setDays, onExtract: runExtract }} />
      )}
      {(view.v === "loading" || view.v === "committing") && (
        <p style={{ color: "var(--hc-text-muted)" }}>
          {view.v === "loading" ? "extracting — reading the grid and labels (this can take a moment)…" : "saving…"}
        </p>
      )}
      {view.v === "review" && (
        <ReviewView draft={view.draft} onChange={(d) => setView({ v: "review", draft: d })} onCommit={() => commit(view.draft)} onBack={() => setView({ v: "import" })} />
      )}
      {view.v === "done" && (
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "var(--hc-done-text)", fontWeight: 700 }}>
            Saved {MONTHS[view.counts.month - 1]} {view.counts.year} — {view.counts.entries} cells persisted.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button style={btnStyle} onClick={() => setView({ v: "dashboard" })}>View dashboard</button>
            <button style={{ ...btnStyle, background: "var(--hc-surface)", color: "var(--hc-text)", border: "1px solid var(--hc-border-strong)" }} onClick={() => { setFile(null); setView({ v: "import" }); }}>Import another</button>
          </div>
        </div>
      )}
      {view.v === "dashboard" && <DashboardView />}
      </div>
    </main>
  );
}

function navBtn(active: boolean): React.CSSProperties {
  return {
    background: active ? "var(--hc-surface-ink)" : "var(--hc-surface)",
    color: active ? "#fff" : "var(--hc-text)",
    border: active ? "none" : "1px solid var(--hc-border-strong)",
    borderRadius: 999, padding: "6px 18px", fontFamily: "var(--hc-font-body)",
    fontWeight: 700, fontSize: 13, cursor: "pointer",
  };
}

const btnStyle: React.CSSProperties = {
  background: "var(--hc-surface-ink)", color: "#fff", border: "none",
  borderRadius: 10, padding: "9px 18px", fontFamily: "var(--hc-font-body)",
  fontWeight: 700, cursor: "pointer",
};
const inputStyle: React.CSSProperties = {
  border: "1px solid var(--hc-border-strong)", borderRadius: 8, padding: "6px 8px",
  fontFamily: "var(--hc-font-body)", background: "var(--hc-surface)",
};

function ImportView(props: {
  file: File | null; setFile: (f: File | null) => void;
  year: number; setYear: (n: number) => void;
  month: number; setMonth: (n: number) => void;
  days: number; setDays: (n: number) => void;
  onExtract: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 460, textAlign: "left" }}>
      <p style={{ color: "var(--hc-text-muted)", margin: 0 }}>
        Photograph the habit grid (crop close to it — keep the charts out), then import it here
        to review and save.
      </p>
      <input ref={fileRef} type="file" accept="image/*" hidden
        onChange={(e) => props.setFile(e.target.files?.[0] ?? null)} />
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          style={{ ...btnStyle, background: "var(--hc-surface)", color: "var(--hc-text)", border: "1px solid var(--hc-border-strong)" }}
          onClick={() => fileRef.current?.click()}>
          Choose image…
        </button>
        <span style={{ fontSize: 12.5, color: "var(--hc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {props.file ? props.file.name : "no image selected"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>Year
          <input style={inputStyle} type="number" value={props.year} onChange={(e) => props.setYear(+e.target.value)} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>Month
          <select style={inputStyle} value={props.month} onChange={(e) => props.setMonth(+e.target.value)}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>Days in grid
          <input style={{ ...inputStyle, width: 64 }} type="number" min={1} max={31} value={props.days} onChange={(e) => props.setDays(+e.target.value)} />
        </label>
      </div>
      <button style={{ ...btnStyle, opacity: props.file ? 1 : 0.5 }} disabled={!props.file} onClick={props.onExtract}>
        Extract
      </button>
    </div>
  );
}

function ReviewView(props: { draft: Draft; onChange: (d: Draft) => void; onCommit: () => void; onBack: () => void }) {
  const { draft } = props;
  const rows = draft.habits.length;
  const days = draft.days;
  const gridCols = useMemo(() => `160px repeat(${days}, 20px)`, [days]);

  function setCell(r: number, day: number) {
    const status = draft.status.map((row) => row.slice());
    status[r][day - 1] = CYCLE[status[r][day - 1]];
    props.onChange({ ...draft, status });
  }
  function setName(r: number, name: string) {
    const habits = draft.habits.slice();
    habits[r] = name;
    props.onChange({ ...draft, habits });
  }
  function flipOrder() {
    props.onChange({
      ...draft,
      habits: [...draft.habits].reverse(),
      status: [...draft.status].reverse(),
      conf: [...draft.conf].reverse(),
    });
  }

  const secondaryBtn: React.CSSProperties = {
    ...btnStyle, background: "var(--hc-surface)", color: "var(--hc-text)",
    border: "1px solid var(--hc-border-strong)",
  };

  return (
    <div style={{ display: "grid", gap: 18, width: "100%" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--hc-font-display)", fontSize: 26 }}>{MONTHS[draft.month - 1]} {draft.year}</span>
        <span style={{ color: "var(--hc-text-muted)", fontSize: 12.5 }}>click a cell: done → missed → empty · orange ring = low confidence</span>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* LEFT column — editable grid, with the action buttons directly under it */}
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 3, alignItems: "center" }}>
              <div />
              {Array.from({ length: days }, (_, d) => (
                <div key={d} style={{ fontSize: 8.5, textAlign: "center", color: "var(--hc-text-faint)" }}>{d + 1}</div>
              ))}
              {Array.from({ length: rows }, (_, r) => (
                <Row key={r} r={r} draft={draft} onName={setName} onCell={setCell} />
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <button style={btnStyle} onClick={props.onCommit}>Commit</button>
            <button style={secondaryBtn} onClick={props.onBack}>Back</button>
            <button style={secondaryBtn} onClick={flipOrder} title="Reverse habit row order to match the reference image">
              Flip ⇅
            </button>
          </div>
        </div>

        {/* RIGHT column — reference image, drag to crop */}
        {draft.rectified && (
          <figure style={{ flex: "0 0 auto", margin: 0, position: "sticky", top: 12 }}>
            <CropImage src={draft.rectified} />
            <figcaption style={{ fontSize: 11.5, color: "var(--hc-text-muted)", marginTop: 6, textAlign: "center" }}>your grid — click to enlarge &amp; crop</figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}

// Small reference thumbnail beside the grid; click to open a large crop modal.
function CropImage({ src }: { src: string }) {
  const [shown, setShown] = useState(src);
  const [open, setOpen] = useState(false);
  useEffect(() => { setShown(src); setOpen(false); }, [src]); // new extraction → drop any prior crop

  return (
    <>
      <img src={shown} alt="your grid" title="click to enlarge & crop" onClick={() => setOpen(true)}
        style={{ maxHeight: "58vh", maxWidth: 220, borderRadius: 12, border: "1px solid var(--hc-border)", display: "block", cursor: "zoom-in" }} />
      {open && <CropModal src={src} shown={shown} setShown={setShown} onClose={() => setOpen(false)} />}
    </>
  );
}

// Full-screen crop dialog: drag a rectangle over the enlarged photo to zoom into a region;
// Reset restores the full image. Pure canvas — no crop library.
function CropModal(props: { src: string; shown: string; setShown: (s: string) => void; onClose: () => void }) {
  const [sel, setSel] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const at = (e: React.PointerEvent) => {
    const r = imgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function down(e: React.PointerEvent) {
    const p = at(e);
    setSel({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (!sel) return;
    const p = at(e);
    setSel({ ...sel, x1: p.x, y1: p.y });
  }
  function up() {
    const img = imgRef.current;
    if (!sel || !img) { setSel(null); return; }
    const r = img.getBoundingClientRect();
    const left = Math.min(sel.x0, sel.x1), top = Math.min(sel.y0, sel.y1);
    const w = Math.abs(sel.x1 - sel.x0), h = Math.abs(sel.y1 - sel.y0);
    setSel(null);
    if (w < 8 || h < 8) return; // a click, not a crop
    const sx = img.naturalWidth / r.width, sy = img.naturalHeight / r.height;
    const c = document.createElement("canvas");
    c.width = Math.round(w * sx); c.height = Math.round(h * sy);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const s = new Image();
    s.onload = () => {
      ctx.drawImage(s, left * sx, top * sy, w * sx, h * sy, 0, 0, c.width, c.height);
      props.setShown(c.toDataURL("image/png"));
    };
    s.src = props.shown;
  }

  const box = sel && {
    left: Math.min(sel.x0, sel.x1), top: Math.min(sel.y0, sel.y1),
    width: Math.abs(sel.x1 - sel.x0), height: Math.abs(sel.y1 - sel.y0),
  };
  const modalBtn: React.CSSProperties = {
    background: "var(--hc-surface)", color: "var(--hc-text)", border: "1px solid var(--hc-border-strong)",
    borderRadius: 8, padding: "6px 14px", fontFamily: "var(--hc-font-body)", fontWeight: 600, fontSize: 13, cursor: "pointer",
  };
  return (
    <div onClick={props.onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,0.72)", zIndex: 50, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} onPointerDown={down} onPointerMove={move} onPointerUp={up}
        style={{ position: "relative", cursor: "crosshair", touchAction: "none", lineHeight: 0 }}>
        <img ref={imgRef} src={props.shown} alt="your grid" draggable={false}
          style={{ maxHeight: "82vh", maxWidth: "90vw", borderRadius: 8, display: "block" }} />
        {box && <div style={{ position: "absolute", ...box, border: "2px solid var(--hc-flag)", background: "rgba(232,132,60,0.15)" }} />}
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span style={{ fontSize: 12.5, color: "#f4ede3" }}>drag over the image to crop</span>
        {props.shown !== props.src && <button style={modalBtn} onClick={() => props.setShown(props.src)}>Reset</button>}
        <button style={modalBtn} onClick={props.onClose}>Close</button>
      </div>
    </div>
  );
}

type MonthItem = { year: number; month: number; imported_at: string; entries: number };
type MonthData = {
  year: number; month: number; days: number;
  habits: { name: string; kind: string; sort_order: number }[];
  entries: { day: number; habit: string; done: number }[];
  sleep: { day: number; hours: number }[];
  moments: { day: number; weekday: string | null; text: string }[];
};

const pct = (done: number, missed: number) => (done + missed === 0 ? null : Math.round((100 * done) / (done + missed)));

// Consecutive "done" days ending at the habit's last tracked day.
function currentStreak(row: CellStatus[]): number {
  let last = -1;
  for (let d = 0; d < row.length; d++) if (row[d] !== "empty") last = d;
  let n = 0;
  for (let d = last; d >= 0 && row[d] === "done"; d--) n++;
  return n;
}

function DashboardView() {
  const [months, setMonths] = useState<MonthItem[] | null>(null);
  const [sel, setSel] = useState<{ year: number; month: number } | null>(null);
  const [data, setData] = useState<MonthData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${await apiBase()}/months`);
        const list = (await res.json()) as MonthItem[];
        setMonths(list);
        if (list.length) setSel({ year: list[0].year, month: list[0].month });
      } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    })();
  }, []);

  useEffect(() => {
    if (!sel) return;
    setData(null);
    (async () => {
      try {
        const res = await fetch(`${await apiBase()}/months/${sel.year}/${sel.month}`);
        if (!res.ok) throw new Error(`month load failed (${res.status})`);
        setData((await res.json()) as MonthData);
      } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    })();
  }, [sel]);

  if (err) return <p style={{ color: "var(--hc-flag-text)" }}>{err}</p>;
  if (months && months.length === 0) return <p style={{ color: "var(--hc-text-muted)" }}>No months yet — import one from the Import tab.</p>;
  if (!months) return <p style={{ color: "var(--hc-text-muted)" }}>loading…</p>;

  return (
    <div style={{ display: "grid", gap: 16, width: "100%", justifyItems: "center" }}>
      <select style={{ ...inputStyle, fontSize: 14 }} value={sel ? `${sel.year}-${sel.month}` : ""}
        onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); setSel({ year: y, month: m }); }}>
        {months.map((m) => (
          <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>{MONTHS[m.month - 1]} {m.year}</option>
        ))}
      </select>
      {data ? <MonthPanel data={data} /> : <p style={{ color: "var(--hc-text-muted)" }}>loading…</p>}
    </div>
  );
}

function MonthPanel({ data }: { data: MonthData }) {
  const { days, habits } = data;
  // build status[habit][day-1]
  const status = useMemo(() => {
    const s = habits.map(() => Array<CellStatus>(days).fill("empty"));
    const hidx = new Map(habits.map((h, i) => [h.name, i]));
    for (const e of data.entries) {
      const r = hidx.get(e.habit);
      if (r === undefined || e.day < 1 || e.day > days) continue;
      s[r][e.day - 1] = e.done ? "done" : "missed";
    }
    return s;
  }, [data, days, habits]);

  let done = 0, missed = 0;
  const dayTotals = Array<number>(days).fill(0);
  for (let r = 0; r < habits.length; r++) {
    for (let d = 0; d < days; d++) {
      const st = status[r][d];
      if (st === "done") { done++; dayTotals[d]++; }
      else if (st === "missed") missed++;
    }
  }
  const monthly = pct(done, missed);
  const gridCols = `150px repeat(${days}, 16px) 46px 40px`;

  const stat = (label: string, value: string) => (
    <div style={{ display: "grid", gap: 2, textAlign: "center" }}>
      <span style={{ fontFamily: "var(--hc-font-display)", fontSize: 30, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 11.5, color: "var(--hc-text-muted)" }}>{label}</span>
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 16, justifyItems: "center" }}>
      <div style={{ display: "flex", gap: 34 }}>
        {stat("monthly completion", monthly === null ? "—" : `${monthly}%`)}
        {stat("done", String(done))}
        {stat("missed", String(missed))}
        {stat("habits", String(habits.length))}
      </div>

      <div style={{ overflowX: "auto", maxWidth: "100%" }}>
        <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 2, alignItems: "center" }}>
          {/* header */}
          <div />
          {Array.from({ length: days }, (_, d) => (
            <div key={d} style={{ fontSize: 8, textAlign: "center", color: "var(--hc-text-faint)" }}>{d + 1}</div>
          ))}
          <div style={{ fontSize: 9, color: "var(--hc-text-faint)", textAlign: "center" }}>%</div>
          <div style={{ fontSize: 9, color: "var(--hc-text-faint)", textAlign: "center" }}>🔥</div>

          {habits.map((h, r) => {
            let hd = 0, hm = 0;
            for (let d = 0; d < days; d++) { if (status[r][d] === "done") hd++; else if (status[r][d] === "missed") hm++; }
            const hp = pct(hd, hm);
            return (
              <Fragment key={h.name}>
                <div style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={h.name}>{h.name}</div>
                {Array.from({ length: days }, (_, d) => (
                  <div key={d} title={`day ${d + 1}: ${status[r][d]}`}
                    style={{ width: 16, height: 16, borderRadius: 3, background: CELL_BG[status[r][d]], border: status[r][d] === "empty" ? "1px solid var(--hc-rule)" : "none" }} />
                ))}
                <div style={{ fontSize: 11, textAlign: "center", color: "var(--hc-text-muted)" }}>{hp === null ? "—" : `${hp}%`}</div>
                <div style={{ fontSize: 11, textAlign: "center", color: "var(--hc-text-muted)" }}>{currentStreak(status[r])}</div>
              </Fragment>
            );
          })}

          {/* daily totals footer */}
          <div style={{ fontSize: 11, color: "var(--hc-text-muted)", whiteSpace: "nowrap" }}>daily total</div>
          {dayTotals.map((t, d) => (
            <div key={d} style={{ fontSize: 8.5, textAlign: "center", color: "var(--hc-text-faint)" }}>{t}</div>
          ))}
          <div /><div />
        </div>
      </div>

      {data.sleep.length > 0 && (
        <p style={{ fontSize: 12, color: "var(--hc-text-muted)", margin: 0 }}>
          sleep logged on {data.sleep.length} day(s) · avg {(data.sleep.reduce((a, s) => a + s.hours, 0) / data.sleep.length).toFixed(1)} h
        </p>
      )}
    </div>
  );
}

function Row(props: { r: number; draft: Draft; onName: (r: number, n: string) => void; onCell: (r: number, day: number) => void }) {
  const { r, draft } = props;
  return (
    <>
      <input
        style={{ ...inputStyle, fontSize: 12, padding: "3px 6px", width: 152 }}
        value={draft.habits[r]}
        onChange={(e) => props.onName(r, e.target.value)}
      />
      {Array.from({ length: draft.days }, (_, d) => {
        const st = draft.status[r][d];
        const low = st !== "empty" && draft.conf[r][d] < LOW_CONF;
        return (
          <button
            key={d}
            title={`day ${d + 1}: ${st}${low ? " (low confidence)" : ""}`}
            onClick={() => props.onCell(r, d + 1)}
            style={{
              width: 20, height: 20, padding: 0, cursor: "pointer",
              borderRadius: 4, background: CELL_BG[st],
              border: st === "empty" ? "1px solid var(--hc-rule)" : "none",
              outline: low ? "2px solid var(--hc-flag)" : "none",
              outlineOffset: -2,
            }}
          />
        );
      })}
    </>
  );
}
