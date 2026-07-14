/**
 * Monotone cubic Hermite spline — passes through all points, preserves monotonicity.
 * Returns an array of interpolated [x, y] points suitable for ECharts smooth line.
 */

export function monotoneSpline(
  points: [number, number][],
  segments: number = 20
): [number, number][] {
  if (points.length < 2) return points;
  const n = points.length;
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);

  // Compute slopes using Fritsch-Carlson method (monotone-preserving)
  const m = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const dx1 = xs[i] - xs[i - 1];
    const dx2 = xs[i + 1] - xs[i];
    const dy1 = ys[i] - ys[i - 1];
    const dy2 = ys[i + 1] - ys[i];
    const s1 = dx1 !== 0 ? dy1 / dx1 : 0;
    const s2 = dx2 !== 0 ? dy2 / dx2 : 0;
    if (s1 * s2 > 0) {
      m[i] = (2 * s1 * s2) / (s1 + s2); // harmonic mean
    }
  }

  // Generate interpolated points
  const result: [number, number][] = [];
  for (let i = 0; i < n - 1; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    const y0 = ys[i], y1 = ys[i + 1];
    const m0 = m[i], m1 = m[i + 1];
    const dx = x1 - x0;
    // Hermite basis: h00, h10, h01, h11
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      const x = x0 + t * dx;
      const y = h00 * y0 + h10 * dx * m0 + h01 * y1 + h11 * dx * m1;
      result.push([x, y]);
    }
  }
  return result;
}

/** Generate dense ECharts-ready coordinates from a CCW polygon */
export function splineHull(
  hull: { x: number; y: number }[],
  segments: number = 15
): [number, number][] {
  if (hull.length < 3) return hull.map(p => [p.x, p.y] as [number, number]);
  const pts = hull.map(p => [p.x, p.y] as [number, number]);
  // Close the loop
  pts.push([hull[0].x, hull[0].y]);
  return monotoneSpline(pts, segments);
}
