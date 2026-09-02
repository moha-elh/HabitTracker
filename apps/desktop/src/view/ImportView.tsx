// View — the import screen: pick the two spread pages (habit grid + optional memorable
// moments), set year/month/days, extract.
import { useRef } from "react";
import { MONTHS, btnStyle, inputStyle, secondaryBtn } from "./theme";

function FilePick(props: { label: string; hint: string; file: File | null; onPick: (f: File | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: "grid", gap: 5 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{props.label}</div>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => props.onPick(e.target.files?.[0] ?? null)} />
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button style={secondaryBtn} onClick={() => ref.current?.click()}>Choose image…</button>
        <span style={{ fontSize: 12.5, color: "var(--hc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {props.file ? props.file.name : props.hint}
        </span>
      </div>
    </div>
  );
}

export function ImportView(props: {
  file: File | null; setFile: (f: File | null) => void;
  moments: File | null; setMoments: (f: File | null) => void;
  year: number; setYear: (n: number) => void;
  month: number; setMonth: (n: number) => void;
  days: number; setDays: (n: number) => void;
  onExtract: () => void;
}) {
  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 460, textAlign: "left" }}>
      <p style={{ color: "var(--hc-text-muted)", margin: 0 }}>
        Photograph the spread as two images — the <b>habit grid</b> (right page, crop close, keep
        the charts out) and the <b>memorable moments</b> (left page). Then review and save.
      </p>
      <FilePick label="Habit grid" hint="required" file={props.file} onPick={props.setFile} />
      <FilePick label="Memorable moments" hint="optional" file={props.moments} onPick={props.setMoments} />
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
