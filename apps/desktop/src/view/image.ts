// View — reference-image rotation (canvas). The image already carries the real handwritten
// habit names (the server includes the margin), so nothing is drawn on; we only reorient it.

// Clockwise rotation applied to the reference image:
//   0 = as captured · 90 = vertical (names upright along the top, Fajr first) · 180 · 270
const REF_IMAGE_ROTATION = 90;

/** Auto-orient the reference to portrait (habit names on top, grid below). The grid is taller
 * than wide (days > habits), so a landscape capture rotates 90° and a portrait one stays put.
 * Returns the oriented data URL plus the chosen rotation so the review Rotate button can cycle
 * from it. The remaining 180° ambiguity (names top vs bottom) is left to that manual button. */
export function orientReference(dataUrl: string): Promise<{ url: string; deg: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      const deg = img.width > img.height ? REF_IMAGE_ROTATION : 0; // landscape → portrait
      resolve({ url: await buildReference(dataUrl, deg), deg });
    };
    img.onerror = () => resolve({ url: dataUrl, deg: 0 });
    img.src = dataUrl;
  });
}

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
