// View — the import screen: pick the two spread pages (habit grid + optional memorable
// moments), set year/month/days, extract. A picked image shows as a thumbnail preview.
import { useEffect, useRef, useState } from "react";
import { MONTHS, btnStyle, inputStyle, secondaryBtn } from "./theme";

function FilePick(props: { label: string; hint: string; file: File | null; onPick: (f: File | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!props.file) { setPreview(null); return; }
    const url = URL.createObjectURL(props.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url); // free the blob when the file changes/clears
  }, [props.file]);

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{props.label}</div>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => props.onPick(e.target.files?.[0] ?? null)} />
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {preview ? (
          <img src={preview} alt={props.file?.name ?? ""} onClick={() => ref.current?.click()} title="click to replace"
            style={{ width: 76, height: 76, objectFit: "cover", borderRadius: 10, border: "1px solid var(--hc-border)", cursor: "pointer", display: "block", flex: "none" }} />
        ) : (
          <button style={secondaryBtn} onClick={() => ref.current?.click()}>Choose image…</button>
        )}
        <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
          <span style={{ fontSize: 12.5, color: "var(--hc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {props.file ? props.file.name : props.hint}
          </span>
          {props.file && (
            <button onClick={() => props.onPick(null)} style={{ ...secondaryBtn, padding: "3px 10px", fontSize: 11.5, justifySelf: "start" }}>Remove</button>
          )}
        </div>
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
        Photograph the spread: the <b>habit grid</b> (right page; include the sleep line chart
        beside it, the hours are read from it) and the <b>memorable moments</b> (left page). Then
        review and save.
      </p>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FilePick label="Habit grid + sleep chart" hint="required" file={props.file} onPick={props.setFile} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FilePick label="Memorable moments" hint="optional" file={props.moments} onPick={props.setMoments} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <label style={{ flex: 1, display: "grid", gap: 4, fontSize: 12.5 }}>Year
          <input style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} type="number" value={props.year} onChange={(e) => props.setYear(+e.target.value)} />
        </label>
        <label style={{ flex: 1, display: "grid", gap: 4, fontSize: 12.5 }}>Month
          <select style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} value={props.month} onChange={(e) => props.setMonth(+e.target.value)}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label style={{ flex: 1, display: "grid", gap: 4, fontSize: 12.5 }}>Days in grid
          <input style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} type="number" min={1} max={31} value={props.days} onChange={(e) => props.setDays(+e.target.value)} />
        </label>
      </div>
      <button style={{ ...btnStyle, opacity: props.file ? 1 : 0.5 }} disabled={!props.file} onClick={props.onExtract}>
        Extract
      </button>
    </div>
  );
}
