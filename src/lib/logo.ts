/**
 * Turns any logo picture into a platform logo in our style: white on transparent, no margins, 96 px high.
 * Background = the colour of the corners (or transparency); every pixel's distance from it becomes the opacity.
 */
export async function makeWhiteLogo(file: File): Promise<{ blob: Blob; url: string }> {
  const src = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('Couldn’t read that picture')); i.src = URL.createObjectURL(file); });
  const W = Math.min(1600, src.naturalWidth || 800), H = Math.round((src.naturalHeight || 400) * (W / (src.naturalWidth || 800)));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!; g.drawImage(src, 0, 0, W, H);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  // the background: average of the four corners (transparent corners → we just use the picture's own transparency)
  const at = (x: number, y: number) => (y * W + x) * 4;
  const corners = [at(0, 0), at(W - 1, 0), at(0, H - 1), at(W - 1, H - 1)];
  const transparentBg = corners.every((i) => d[i + 3] < 20);
  const bg = [0, 1, 2].map((k) => corners.reduce((s, i) => s + d[i + k], 0) / 4);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = at(x, y);
    let a: number;
    if (transparentBg) a = d[i + 3];
    else { const dist = Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]); a = Math.min(255, Math.max(0, (dist - 18) * 2.2)) * (d[i + 3] / 255); }
    d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = a;
    if (a > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) throw new Error('Couldn’t find a logo in that picture');
  g.putImageData(img, 0, 0);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, outH = 96, outW = Math.max(1, Math.round(cw * (outH / ch)));
  const o = document.createElement('canvas'); o.width = outW; o.height = outH;
  const og = o.getContext('2d')!; og.imageSmoothingQuality = 'high'; og.drawImage(c, x0, y0, cw, ch, 0, 0, outW, outH);
  const blob = await new Promise<Blob>((ok) => o.toBlob((b) => ok(b!), 'image/png'));
  return { blob, url: URL.createObjectURL(blob) };
}
