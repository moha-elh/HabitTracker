// Controller — the screen state machine and the handlers that wire views to the model/api.
import { useEffect, useState } from "react";
import type { Draft, View } from "./model/types";
import { commitExtraction, extractImage } from "./model/api";
import { draftFromExtraction, toExtraction } from "./model/draft";
import { buildReference } from "./view/image";
import { MONTHS, btnStyle, navBtn, secondaryBtn } from "./view/theme";
import { ImportView } from "./view/ImportView";
import { ReviewView } from "./view/ReviewView";
import { DashboardView } from "./view/Dashboard";

const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();
const msg = (e: unknown) => String(e instanceof Error ? e.message : e);

export default function App() {
  const [view, setView] = useState<View>({ v: "import" });
  const [file, setFile] = useState<File | null>(null);
  const [momentsFile, setMomentsFile] = useState<File | null>(null);
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
      const { extraction, referenceB64, momentsStatus } = await extractImage(file, momentsFile, year, month, days);
      const rectified = await buildReference(`data:image/png;base64,${referenceB64}`);
      // If a moments image was sent but nothing came back, tell the user why (and that they can
      // still add lines by hand in review). momentsStatus is "read N" on success.
      if (momentsFile && !momentsStatus.startsWith("read ")) {
        setError(
          momentsStatus === "no image"
            ? "The sidecar didn't process the moments image — fully restart the app so it picks up the new code."
            : `Couldn't read moments from that page (${momentsStatus}). Add them by hand below, or try a clearer photo.`,
        );
      }
      setView({ v: "review", draft: draftFromExtraction(extraction, rectified, days) });
    } catch (e) {
      setError(msg(e));
      setView({ v: "import" });
    }
  }

  async function commit(draft: Draft) {
    setError(null);
    setView({ v: "committing", draft });
    try {
      const rec = await commitExtraction(toExtraction(draft));
      setView({ v: "done", counts: { entries: rec.entries, year: rec.year, month: rec.month } });
    } catch (e) {
      setError(msg(e));
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
          <ImportView {...{ file, setFile, moments: momentsFile, setMoments: setMomentsFile, year, setYear, month, setMonth, days, setDays, onExtract: runExtract }} />
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
              <button style={secondaryBtn} onClick={() => { setFile(null); setMomentsFile(null); setView({ v: "import" }); }}>Import another</button>
            </div>
          </div>
        )}
        {view.v === "dashboard" && <DashboardView />}
      </div>
    </main>
  );
}
