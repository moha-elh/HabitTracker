// View — reference-image rotation (canvas). The image already carries the real handwritten
// habit names (the server includes the margin), so nothing is drawn on; we only reorient it.

// Clockwise rotation applied to the reference image:
//   0 = as captured · 90 = vertical (names upright along the top, Fajr first) · 180 · 270
const REF_IMAGE_ROTATION = 90;

export function buildReference(dataUrl: string, deg: number = REF_IMAGE_ROTATION): Promise<string> {
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
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((d * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
