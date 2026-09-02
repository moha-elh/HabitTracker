// View — the reference thumbnail beside the review grid; click to open a large crop modal.
import { useEffect, useRef, useState } from "react";

export function CropImage({ src }: { src: string }) {
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
