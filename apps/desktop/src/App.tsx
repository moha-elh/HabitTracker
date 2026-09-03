// Controller — the screen state machine and the handlers that wire views to the model/api.
import { useEffect, useState } from "react";
import type { Draft, View } from "./model/types";
import { commitExtraction, extractImage } from "./model/api";
import { draftFromExtraction, toExtraction } from "./model/draft";
import { orientReference } from "./view/image";
import { MONTHS, btnStyle, navBtn, secondaryBtn } from "./view/theme";
import { ImportView } from "./view/ImportView";
import { ReviewView } from "./view/ReviewView";
import { DashboardView } from "./view/Dashboard";
import { TrendsView } from "./view/Trends";

const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();
const msg = (e: unknown) => String(e instanceof Error ? e.message : e);

/** Read a picked File into a data URL so it can be archived with the commit. */
const fileToDataURL = (f: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

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
      const { extraction, referenceB64, momentsStatus, sleepStatus } = await extractImage(file, momentsFile, year, month, days);
      const raw = `data:image/png;base64,${referenceB64}`;
      const { url: rectified, deg } = await orientReference(raw); // auto-orient to portrait (names on top)
      const gridPhoto = await fileToDataURL(file); // full photo, keeps the sleep chart the crop drops
      const momentsImage = momentsFile ? await fileToDataURL(momentsFile) : null;
      // Surface read problems (fixable by hand in review). Sleep runs on the grid image every
      // import, so only flag a hard error; moments only when a page was actually provided.
      const warns: string[] = [];
      if (momentsFile && !momentsStatus.startsWith("read ")) warns.push(`moments (${momentsStatus})`);
      if (sleepStatus.startsWith("error:")) warns.push(`sleep (${sleepStatus})`);
      if (warns.length) setError(`Couldn't read: ${warns.join(", ")}. Fix by hand in review, or try a clearer photo.`);
      const draft = draftFromExtraction(extraction, rectified, days, momentsImage);
      setView({ v: "review", draft: { ...draft, referenceRaw: raw, refDeg: deg, gridPhoto } });
    } catch (e) {
      setError(msg(e));
      setView({ v: "import" });
    }
  }

  async function commit(draft: Draft) {
    setError(null);
    setView({ v: "committing", draft });
    try {
      const rec = await commitExtraction(toExtraction(draft), {
        grid_image: draft.rectified || null,
        moments_image: draft.momentsImage,
      });
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

        {(view.v === "import" || view.v === "dashboard" || view.v === "trends" || view.v === "done") && (
          <nav style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <button style={navBtn(view.v === "import")} onClick={() => setView({ v: "import" })}>Import</button>
            <button style={navBtn(view.v === "dashboard")} onClick={() => setView({ v: "dashboard" })}>Dashboard</button>
            <button style={navBtn(view.v === "trends")} onClick={() => setView({ v: "trends" })}>Trends</button>
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
            {view.v === "loading" ? "extracting: reading the grid and labels (this can take a moment)…" : "saving…"}
          </p>
        )}
        {view.v === "review" && (
          <ReviewView draft={view.draft} onChange={(d) => setView({ v: "review", draft: d })} onCommit={() => commit(view.draft)} onBack={() => setView({ v: "import" })} />
        )}
        {view.v === "done" && (
          <div style={{ textAlign: "center", background: "var(--hc-surface)", border: "1px solid var(--hc-border)", borderRadius: 18, padding: "40px 48px", maxWidth: 460 }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--hc-done-tint)", color: "var(--hc-done-text)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, margin: "0 auto 18px" }}>✓</div>
            <div style={{ fontSize: 11.5, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--hc-text-label)", fontWeight: 700 }}>Saved to your chronicle</div>
            <div style={{ fontFamily: "var(--hc-font-display)", fontSize: 40, fontWeight: 400, lineHeight: 1.1, margin: "8px 0 6px" }}>
              {MONTHS[view.counts.month - 1]} {view.counts.year}
            </div>
            <div style={{ fontSize: 14, color: "var(--hc-text-muted)", marginBottom: 24 }}>
              {view.counts.entries} habit cells committed to the dashboard.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button style={btnStyle} onClick={() => setView({ v: "dashboard" })}>View dashboard</button>
              <button style={secondaryBtn} onClick={() => { setFile(null); setMomentsFile(null); setView({ v: "import" }); }}>Import another</button>
            </div>
          </div>
        )}
        {view.v === "dashboard" && <DashboardView />}
        {view.v === "trends" && <TrendsView />}
      </div>
    </main>
  );
}
