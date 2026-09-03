// View — the review & correct screen, a 3-step wizard: (1) fix the habit grid, (2) fix the
// sleep hours, (3) fix the memorable moments, then commit. Each step keeps the source photo
// beside it. Cell/name/flip/sleep/moment edits go through the pure model/draft helpers.
import { useMemo, useState } from "react";
import type { Draft } from "../model/types";
import { addMoment, cycleCell, flipDraft, removeMoment, renameHabit, setMomentDay, setMomentText, setSleep } from "../model/draft";
import { CARD, CELL_BG, LOW_CONF, MONTHS, btnStyle, inputStyle, secondaryBtn } from "./theme";
import { CropImage } from "./CropImage";
import { buildReference } from "./image";

const STEPS = ["Habit grid", "Sleep hours", "Memorable moments"] as const;

export function ReviewView(props: { draft: Draft; onChange: (d: Draft) => void; onCommit: () => void; onBack: () => void }) {
  const { draft, onChange } = props;
  const [step, setStep] = useState(0);
  const last = STEPS.length - 1;

  return (
    <div style={{ display: "grid", gap: 18, width: "100%" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--hc-font-display)", fontSize: 26 }}>{MONTHS[draft.month - 1]} {draft.year}</span>
        <span style={{ color: "var(--hc-text-muted)", fontSize: 12.5 }}>Step {step + 1} of {STEPS.length}: {STEPS[step]}</span>
      </div>

      <Stepper step={step} onGo={setStep} />

      {step === 0 && <GridStep draft={draft} onChange={onChange} />}
      {step === 1 && <SleepStep draft={draft} onChange={onChange} />}
      {step === 2 && <MomentsStep draft={draft} onChange={onChange} />}

      <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
        {step === last
          ? <button style={btnStyle} onClick={props.onCommit}>Commit</button>
          : <button style={btnStyle} onClick={() => setStep(step + 1)}>Next</button>}
        <button style={secondaryBtn} onClick={() => (step === 0 ? props.onBack() : setStep(step - 1))}>Back</button>
      </div>
    </div>
  );
}

/** Clickable step pills showing progress through the wizard. */
function Stepper(props: { step: number; onGo: (s: number) => void }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {STEPS.map((name, i) => {
        const active = i === props.step;
        const done = i < props.step;
        return (
          <button key={name} onClick={() => props.onGo(i)}
            style={{ ...secondaryBtn, padding: "6px 12px", fontSize: 12.5, fontWeight: active ? 700 : 500,
              background: active ? "var(--hc-surface-ink)" : done ? "var(--hc-done-tint)" : "var(--hc-surface)",
              color: active ? "#fff" : done ? "var(--hc-done-text)" : "var(--hc-text-muted)",
              border: active ? "1px solid var(--hc-surface-ink)" : undefined }}>
            {i + 1}. {name}{done ? " ✓" : ""}
          </button>
        );
      })}
    </div>
  );
}

/** Step 1: the editable habit×day grid beside the grid reference photo. */
function GridStep(props: { draft: Draft; onChange: (d: Draft) => void }) {
  const { draft, onChange } = props;
  const rows = draft.habits.length;
  const days = draft.days;
  const gridCols = useMemo(() => `160px repeat(${days}, 20px)`, [days]);

  // Rotate the reference photo 90° per click (any upload angle → names on top, grid below).
  async function rotateRef() {
    const deg = (draft.refDeg + 90) % 360;
    const url = await buildReference(draft.referenceRaw, deg);
    onChange({ ...draft, refDeg: deg, rectified: url });
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <span style={{ color: "var(--hc-text-muted)", fontSize: 12.5 }}>click a cell: done → missed → empty · orange ring = low confidence</span>
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
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
          <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button style={secondaryBtn} onClick={rotateRef} title="Rotate the reference photo so the habit names sit readable on top">
              Rotate ⟳
            </button>
            <button style={secondaryBtn} onClick={() => onChange(flipDraft(draft))} title="Reverse habit row order to match the reference image">
              Flip ⇅
            </button>
          </div>
        </div>

        {draft.rectified && (
          <figure style={{ flex: "0 0 auto", margin: 0, position: "sticky", top: 12 }}>
            <CropImage src={draft.rectified} />
            <figcaption style={{ fontSize: 11.5, color: "var(--hc-text-muted)", marginTop: 6, textAlign: "center" }}>your grid · click to enlarge &amp; crop</figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}

/** Step 2: the per-day sleep hours across the page, with the full grid photo (which holds the
 * sleep line chart) on the right to read the blue line off. */
function SleepStep(props: { draft: Draft; onChange: (d: Draft) => void }) {
  return (
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap", width: "100%" }}>
      <SleepEditor draft={props.draft} onChange={props.onChange} />
      {props.draft.gridPhoto && (
        <figure style={{ flex: "0 0 auto", margin: 0, position: "sticky", top: 12 }}>
          <CropImage src={props.draft.gridPhoto} />
          <figcaption style={{ fontSize: 11.5, color: "var(--hc-text-muted)", marginTop: 6, textAlign: "center" }}>read the blue sleep line off this photo</figcaption>
        </figure>
      )}
    </div>
  );
}

/** Step 3: the memorable moments across the whole page, no reference image (verified by hand). */
function MomentsStep(props: { draft: Draft; onChange: (d: Draft) => void }) {
  return <MomentsEditor draft={props.draft} onChange={props.onChange} />;
}

function SleepEditor(props: { draft: Draft; onChange: (d: Draft) => void }) {
  const { draft, onChange } = props;
  return (
    <div style={{ ...CARD, flex: "1 1 420px", minWidth: 0 }}>
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
    <div style={{ ...CARD, width: "100%" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Memorable moments</div>
          <div style={{ fontSize: 11.5, color: "var(--hc-text-faint)", marginTop: 2 }}>read from the left page · fix any misreads before saving</div>
        </div>
        <button style={{ ...secondaryBtn, padding: "6px 12px", fontSize: 12.5 }} onClick={() => onChange(addMoment(draft))}>+ Add</button>
      </div>
      {draft.moments.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--hc-text-muted)" }}>No moments yet. Import the left page too, or add lines by hand.</div>
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
