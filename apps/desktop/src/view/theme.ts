// View — shared constants and design-token styles (direction 2a). Colors come from tokens.css
// via var(--hc-*); never hardcode a hex the tokens already define.
import type { CellStatus } from "../contract";

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const MON3 = MONTHS.map((m) => m.slice(0, 3));
export const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const LOW_CONF = 0.6; // orange ring below this confidence in the review grid

export const btnStyle: React.CSSProperties = {
  background: "var(--hc-surface-ink)", color: "#fff", border: "none",
  borderRadius: 10, padding: "9px 18px", fontFamily: "var(--hc-font-body)",
  fontWeight: 700, cursor: "pointer",
};

export const secondaryBtn: React.CSSProperties = {
  ...btnStyle, background: "var(--hc-surface)", color: "var(--hc-text)",
  border: "1px solid var(--hc-border-strong)",
};

export const inputStyle: React.CSSProperties = {
  border: "1px solid var(--hc-border-strong)", borderRadius: 8, padding: "6px 8px",
  fontFamily: "var(--hc-font-body)", background: "var(--hc-surface)",
};

export function navBtn(active: boolean): React.CSSProperties {
  return {
    background: active ? "var(--hc-surface-ink)" : "var(--hc-surface)",
    color: active ? "#fff" : "var(--hc-text)",
    border: active ? "none" : "1px solid var(--hc-border-strong)",
    borderRadius: 999, padding: "6px 18px", fontFamily: "var(--hc-font-body)",
    fontWeight: 700, fontSize: 13, cursor: "pointer",
  };
}

// Dashboard card chrome.
export const CARD: React.CSSProperties = { background: "var(--hc-surface)", border: "1px solid var(--hc-border)", borderRadius: 16, padding: "18px 20px" };
export const PANEL: React.CSSProperties = { background: "var(--hc-surface)", border: "1px solid var(--hc-border)", borderRadius: 18 };
export const LABEL: React.CSSProperties = { fontSize: 11.5, color: "var(--hc-text-label)", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" };
export const METRIC: React.CSSProperties = { fontSize: 32, fontWeight: 900, letterSpacing: "-.02em", lineHeight: 1 };

export const CELL_BG: Record<CellStatus, string> = {
  done: "var(--hc-done)",
  missed: "var(--hc-missed)",
  empty: "var(--hc-surface-sunk)",
};
