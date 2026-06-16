/**
 * 2D Graham Scan convex hull + gap detection + inside-polygon test
 */

export interface Point2D { x: number; y: number; id?: string }

/** Cross product of OA and OB vectors */
function cross(o: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Graham Scan: returns hull vertices in CCW order */
export function convexHull(points: Point2D[]): Point2D[] {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: Point2D[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
}

/** Is point p inside convex polygon (CCW vertices)? Uses ray casting */
export function pointInConvexPolygon(p: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false;
  let sign: number | null = null;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const c = cross(a, b, p);
    if (c === 0) continue; // on the edge
    if (sign === null) sign = c > 0 ? 1 : -1;
    else if (c > 0 !== sign > 0) return false;
  }
  return true;
}

/** Find hull edges where the gap (length) exceeds threshold → potential new Pareto spots */
export interface HullGap {
  a: Point2D; b: Point2D;
  length: number;
  midpoint: Point2D;
}

export function findGaps(hull: Point2D[], threshold: number): HullGap[] {
  const gaps: HullGap[] = [];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len >= threshold) {
      gaps.push({
        a, b, length: len,
        midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      });
    }
  }
  return gaps;
}

/** Count how many 2D projections a point is inside the hull → weakness score */
export function computeWeaknessScore(
  target: Point2D,
  allProjections: { dims: string[]; hull: Point2D[] }[]
): { score: number; total: number; weakDims: string[] } {
  let inside = 0;
  const weakDims: string[] = [];
  for (const proj of allProjections) {
    if (pointInConvexPolygon(target, proj.hull)) {
      inside++;
      weakDims.push(proj.dims.join("+"));
    }
  }
  return { score: inside, total: allProjections.length, weakDims };
}
