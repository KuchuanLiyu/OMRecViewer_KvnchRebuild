/**
 * Kernel Density Estimation — smooth canvas heatmap.
 * Renders to offscreen canvas → data URL for single SVG <image>.
 */

export interface KdeData {
  dataUrl: string;    // PNG data URL for SVG <image href="...">
  xMin: number; xMax: number;
  yMin: number; yMax: number;
}

export function kde2d(
  points: [number, number][],
  resW?: number, resH?: number
): KdeData | null {
  const n = points.length;
  if (n < 3) return null;

  // Render resolution (pixels in the output image)
  const rw = resW ?? 160;
  const rh = resH ?? 100;

  // Bounds with 10% padding
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const [x, y] of points) {
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
  }
  const xPad = (xMax - xMin) * 0.1 || 0.5;
  const yPad = (yMax - yMin) * 0.1 || 0.5;
  xMin -= xPad; xMax += xPad;
  yMin -= yPad; yMax += yPad;

  // Bandwidth via Scott's rule
  const bw = n ** (-1 / 6);
  const hx = bw * (xMax - xMin) / Math.sqrt(rw);
  const hy = bw * (yMax - yMin) / Math.sqrt(rh);
  const hx2 = 2 * hx * hx;
  const hy2 = 2 * hy * hy;
  const norm = 1 / (n * Math.PI * Math.sqrt(hx2 * hy2));

  // Compute density
  const density: number[][] = [];
  let maxD = 0;
  for (let gy = 0; gy < rh; gy++) {
    const row: number[] = [];
    const cy = yMin + (gy / (rh - 1)) * (yMax - yMin);
    for (let gx = 0; gx < rw; gx++) {
      const cx = xMin + (gx / (rw - 1)) * (xMax - xMin);
      let sum = 0;
      for (const [px, py] of points) {
        const dx = (cx - px) / hx;
        const dy = (cy - py) / hy;
        sum += Math.exp(-0.5 * (dx * dx + dy * dy));
      }
      const d = sum * norm;
      row.push(d);
      if (d > maxD) maxD = d;
    }
    density.push(row);
  }

  if (maxD > 0) {
    for (let gy = 0; gy < rh; gy++)
      for (let gx = 0; gx < rw; gx++)
        density[gy][gx] /= maxD;
  }

  // Render to offscreen canvas
  const canvas = document.createElement("canvas");
  canvas.width = rw; canvas.height = rh;
  const ctx = canvas.getContext("2d")!;
  const imgData = ctx.createImageData(rw, rh);

  for (let py = 0; py < rh; py++) {
    for (let px = 0; px < rw; px++) {
      const d = density[rh - 1 - py][px]; // flip Y
      const idx = (py * rw + px) * 4;
      if (d < 0.005) {
        imgData.data[idx + 3] = 0;
      } else {
        // Blue(cold) → cyan → yellow → red(hot)
        const t = d;
        imgData.data[idx]     = Math.floor(Math.min(255, t * 3 * 200));
        imgData.data[idx + 1] = Math.floor(Math.min(255, (1 - Math.abs(t - 0.33) * 3) * 120));
        imgData.data[idx + 2] = Math.floor(Math.min(255, (1 - t) * 2 * 180));
        imgData.data[idx + 3] = Math.floor(Math.min(255, t * 80 + 15));
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);

  return { dataUrl: canvas.toDataURL("image/png"), xMin, xMax, yMin, yMax };
}
