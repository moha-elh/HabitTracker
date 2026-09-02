// View — the review & correct screen: editable habit×day grid on the left, reference image
// (croppable) on the right. Cell/name/flip edits go through the pure model/draft helpers.
import { useMemo } from "react";
import type { Draft } from "../model/types";
import { addMoment, cycleCell, flipDraft, removeMoment, renameHabit, setMomentDay, setMomentText, setSleep } from "../model/draft";
import { CARD, CELL_BG, LOW_CONF, MONTHS, btnStyle, inputStyle, secondaryBtn } from "./theme";
import { CropImage } from "./CropImage";

export function ReviewView(props: { draft: Draft; onChange: (d: Draft) => void; onCommit: () => void; onBack: () => void }) {
  const { draft, onChange } = props;
  const rows = draft.habits.length;
  const days = draft.days;
  const gridCols = useMemo(() => `160px repeat(${days}, 20px)`, [days]);

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
                <Row key={r} r={r} draft={draft}
                  onName={(name) => onChange(renameHabit(draft, r, name))}
                  onCell={(day) => onChange(cycleCell(draft, r, day))} />
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <button style={btnStyle} onClick={props.onCommit}>Commit</button>
            <button style={secondaryBtn} onClick={props.onBack}>Back</button>
            <button style={secondaryBtn} onClick={() => onChange(flipDraft(draft))} title="Reverse habit row order to match the reference image">
              Flip ⇅
            </button>
          </div>
        </div>

        {/* RIGHT column — reference image, click to enlarge & crop */}
        {draft.rectified && (
          <figure style={{ flex: "0 0 auto", margin: 0, position: "sticky", top: 12 }}>
            <CropImage src={draft.rectified} />
            <figcaption style={{ fontSize: 11.5, color: "var(--hc-text-muted)", marginTop: 6, textAlign: "center" }}>your grid — click to enlarge &amp; crop</figcaption>
          </figure>
        )}
      </div>

      <SleepEditor draft={draft} onChange={onChange} />
      <MomentsEditor draft={draft} onChange={onChange} />
    </div>
  );
}

function SleepEditor(props: { draft: Draft; onChange: (d: Draft) => void }) {
  const { draft, onChange } = props;
  return (
    <div style={{ ...CARD, maxWidth: 720 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>Sleep <span style={{ fontSize: 12, fontWeight: 400, color: "var(--hc-text-faint)" }}>hours per night</span></div>
      <div style={{ fontSize: 11.5, color: "var(--hc-text-faint)", marginTop: 2, marginBottom: 12 }}>read the blue line off your photo · leave a day blank for no reading</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 44px)", gap: 8 }}>
        {draft.sleep.map((h, d) => (
          <label key={d} style={{ display: "grid", gap: 2, justifyItems: "center" }}>
            <span style={{ fontSize: 9, color: "var(--hc-text-faint)", fontVariantNumeric: "tabular-nums" }}>{d + 1}</span>
            <input type="number" min={0} max={24} step={0.5} value={h ?? ""}
              onChange={(e) => onChange(setSleep(draft, d + 1, e.target.value === "" ? null : +e.target.value))}
              style={{ ...inputStyle, width: 44, padding: "3px 4px", fontSize: 12, textAlign: "center" }} />
          </label>
        ))}
      </div>
    </div>
  );
}

function MomentsEditor(props: { draft: Draft; onChange: (d: Draft) => void }) {
  const { draft, onChange } = props;
  return (
    <div style={{ ...CARD, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Memorable moments</div>
          <div style={{ fontSize: 11.5, color: "var(--hc-text-faint)", marginTop: 2 }}>read from the left page · fix any misreads before saving</div>
        </div>
        <button style={{ ...secondaryBtn, padding: "6px 12px", fontSize: 12.5 }} onClick={() => onChange(addMoment(draft))}>+ Add</button>
      </div>
      {draft.moments.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--hc-text-muted)" }}>No moments — import the left page too, or add lines by hand.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {draft.moments.map((m, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="number" min={1} max={draft.days} value={m.day}
                onChange={(e) => onChange(setMomentDay(draft, i, +e.target.value))}
                style={{ ...inputStyle, width: 52, textAlign: "center", fontSize: 12.5 }} />
              <input value={m.text} placeholder="what happened that day…"
                onChange={(e) => onChange(setMomentText(draft, i, e.target.value))}
                style={{ ...inputStyle, flex: 1, fontSize: 12.5 }} />
              <button title="remove" onClick={() => onChange(removeMoment(draft, i))}
                style={{ ...secondaryBtn, padding: "4px 10px", fontSize: 14, fontWeight: 700 }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row(props: { r: number; draft: Draft; onName: (n: string) => void; onCell: (day: number) => void }) {
  const { r, draft } = props;
  return (
    <>
      <input
        style={{ ...inputStyle, fontSize: 12, padding: "3px 6px", width: 152 }}
        value={draft.habits[r]}
        onChange={(e) => props.onName(e.target.value)}
      />
      {Array.from({ length: draft.days }, (_, d) => {
        const st = draft.status[r][d];
        const low = st !== "empty" && draft.conf[r][d] < LOW_CONF;
        return (
          <button
            key={d}
            title={`day ${d + 1}: ${st}${low ? " (low confidence)" : ""}`}
            onClick={() => props.onCell(d + 1)}
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
