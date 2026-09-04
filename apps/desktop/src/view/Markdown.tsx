// Tiny GitHub-flavored-markdown renderer for the LLM reviews: ### headings, - bullets, **bold**.
// Shared by the dashboard insights page and the Trends full-review card.
import type { ReactNode } from "react";

export function renderReview(text: string): ReactNode[] {
  // Emphasize **double** and *single* asterisks alike — the model is told to bold key values with
  // ** but slips to * sometimes; treat both as bold so no literal asterisks leak into the text.
  const bold = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g).map((part, i) =>
      /^\*\*[^*]+\*\*$/.test(part) ? <strong key={i}>{part.slice(2, -2)}</strong>
      : /^\*[^*\n]+\*$/.test(part) ? <strong key={i}>{part.slice(1, -1)}</strong>
      : <span key={i}>{part}</span>);
  const out: ReactNode[] = [];
  let bullets: ReactNode[] = [];
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
