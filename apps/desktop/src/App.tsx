import { useEffect, useMemo, useState } from "react";
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
// The habit labels are drawn along the top for 90/270; if you change this, label placement
// may need adjusting.
const REF_IMAGE_ROTATION = 90;

// Rotate the rectified grid and draw the habit names onto it (in grid order), so the reference
// image reads the same way as the editable grid.
function buildRef(dataUrl: string, habits: string[], deg: number): Promise<string> {
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
      ctx.save();
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((d * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();

      const n = habits.length;
      if (n && swap) {
        // habits run left→right across the top; label each column, text vertical
        ctx.font = "bold 12px Lato, system-ui, sans-serif";
        ctx.textBaseline = "middle";
        const colW = c.width / n;
        for (let i = 0; i < n; i++) {
          const idx = d === 90 ? i : n - 1 - i; // 270 mirrors the order
          const name = habits[idx] || `Habit ${idx + 1}`;
          const x = (i + 0.5) * colW;
          ctx.save();
          ctx.translate(x, 5);
          ctx.rotate(Math.PI / 2);
          const tw = Math.min(ctx.measureText(name).width, c.height - 12);
          ctx.fillStyle = "rgba(255,255,255,0.8)";
          ctx.fillRect(-2, -9, tw + 4, 16);
          ctx.fillStyle = "#241e18";
          ctx.fillText(name, 0, 0);
          ctx.restore();
        }
      }
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
  | { v: "done"; counts: { entries: number; year: number; month: number } };

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
  return { year: ex.year, month: ex.month, days, habits: ex.habits.map((h) => h.name), status, conf, rectified };
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
  const [flipHabits, setFlipHabits] = useState(true);
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
      form.append("flip_habits", String(flipHabits));
      const res = await fetch(`${await apiBase()}/extract`, { method: "POST", body: form });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || `extract failed (${res.status})`);
      }
      const body = await res.json();
      const ex = body.extraction as Extraction;
      const rectified = await buildRef(`data:image/png;base64,${body.rectified_png_b64}`, ex.habits.map((h) => h.name), REF_IMAGE_ROTATION);
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
      <div style={{ width: "100%", maxWidth: 1240, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <h1 style={{ fontFamily: "var(--hc-font-display)", fontSize: 46, fontWeight: 400, margin: "0 0 18px", textAlign: "center" }}>
        Habit Chronicle
      </h1>

      {error && (
        <div style={{ background: "var(--hc-flag-bg)", color: "var(--hc-flag-text)", border: "1px solid var(--hc-flag-border)", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
          {error}
        </div>
      )}

      {view.v === "import" && (
        <ImportView {...{ file, setFile, year, setYear, month, setMonth, days, setDays, flipHabits, setFlipHabits, onExtract: runExtract }} />
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
        <div>
          <p style={{ color: "var(--hc-done-text)", fontWeight: 700 }}>
            Saved {MONTHS[view.counts.month - 1]} {view.counts.year} — {view.counts.entries} cells persisted.
          </p>
          <button style={btnStyle} onClick={() => { setFile(null); setView({ v: "import" }); }}>Import another</button>
        </div>
      )}
      </div>
    </main>
  );
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
  flipHabits: boolean; setFlipHabits: (b: boolean) => void;
  onExtract: () => void;
}) {
  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 460, textAlign: "left" }}>
      <p style={{ color: "var(--hc-text-muted)", margin: 0 }}>
        Photograph the habit grid (crop close to it — keep the charts out), then import it here
        to review and save.
      </p>
      <input type="file" accept="image/*" onChange={(e) => props.setFile(e.target.files?.[0] ?? null)} />
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
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--hc-text-body)" }}>
        <input type="checkbox" checked={props.flipHabits} onChange={(e) => props.setFlipHabits(e.target.checked)} />
        Reverse habit order (turn off if the habit names come out inverted)
      </label>
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

  return (
    <div style={{ display: "grid", gap: 18, width: "100%" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--hc-font-display)", fontSize: 26 }}>{MONTHS[draft.month - 1]} {draft.year}</span>
        <span style={{ color: "var(--hc-text-muted)", fontSize: 12.5 }}>click a cell: done → missed → empty · orange ring = low confidence</span>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* editable grid on the LEFT — habits as rows, days as columns */}
        <div style={{ flex: "1 1 auto", minWidth: 0, overflowX: "auto" }}>
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

        {/* reference image on the RIGHT — rotated upright */}
        {draft.rectified && (
          <figure style={{ flex: "0 0 auto", margin: 0, position: "sticky", top: 12 }}>
            <img src={draft.rectified} alt="your grid" style={{ maxHeight: "80vh", maxWidth: 400, borderRadius: 12, border: "1px solid var(--hc-border)" }} />
            <figcaption style={{ fontSize: 11.5, color: "var(--hc-text-muted)", marginTop: 6, textAlign: "center" }}>your grid — compare &amp; fix</figcaption>
          </figure>
        )}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button style={btnStyle} onClick={props.onCommit}>Commit</button>
        <button style={{ ...btnStyle, background: "var(--hc-surface)", color: "var(--hc-text)", border: "1px solid var(--hc-border-strong)" }} onClick={props.onBack}>
          Back
        </button>
      </div>
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
