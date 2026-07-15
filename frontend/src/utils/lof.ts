/**
 * Local Outlier Factor — density-based outlier detection.
 * LOF ≈ 1 = normal density, LOF > 1.5 = mild outlier, LOF > 2 = strong outlier.
 */

export interface LofResult {
  index: number;
  lof: number;       // >1 = sparser than neighbors = outlier
  level: 'normal' | 'mild' | 'outlier';
  kDist: number;     // distance to k-th neighbor
}

export function localOutlierFactor(input: number[][], k?: number): LofResult[] {
  const n = input.length;
  if (n < 3) return input.map((_, i) => ({
    index: i, lof: 1, level: 'normal' as const, kDist: 0,
  }));

  const kn = k ?? Math.min(8, n - 1);
  const dim = input[0].length;

  // Normalize each dimension to [0,1] safely (no Math.min(...spread))
  const points: number[][] = input.map(v => [...v]);
  for (let d = 0; d < dim; d++) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < n; i++) {
      if (points[i][d] < min) min = points[i][d];
      if (points[i][d] > max) max = points[i][d];
    }
    const range = max - min;
    if (range > 1e-9) {
      for (let i = 0; i < n; i++) points[i][d] = (points[i][d] - min) / range;
    }
  }

  // 1. Compute all pairwise distances
  const dist = (i: number, j: number): number => {
    let sum = 0;
    for (let d = 0; d < dim; d++) sum += (points[i][d] - points[j][d]) ** 2;
    return Math.sqrt(sum);
  };

  // 2. k-distance for each point + neighbor indices sorted by distance
  const kDists: number[] = [];
  const neighbors: number[][] = [];
  for (let i = 0; i < n; i++) {
    const dists = Array.from({ length: n }, (_, j) => ({ j, d: i === j ? Infinity : dist(i, j) }));
    dists.sort((a, b) => a.d - b.d);
    kDists[i] = dists[kn - 1]?.d ?? 0;
    neighbors[i] = dists.filter(x => isFinite(x.d)).slice(0, kn).map(x => x.j);
  }

  // 3. Local reachability density
  const lrd = (i: number): number => {
    const neigh = neighbors[i];
    if (neigh.length === 0) return 0;
    let sum = 0;
    for (const j of neigh) {
      sum += Math.max(kDists[j], dist(i, j));
    }
    return neigh.length / sum;
  };

  // 4. LOF = avg(lrd of neighbors) / lrd of point
  const results: LofResult[] = [];
  for (let i = 0; i < n; i++) {
    const myLrd = lrd(i);
    const neigh = neighbors[i];
    if (myLrd === 0 || neigh.length === 0) {
      results.push({ index: i, lof: 1, level: 'normal', kDist: kDists[i] });
      continue;
    }
    let avgNeighLrd = 0;
    for (const j of neigh) avgNeighLrd += lrd(j);
    avgNeighLrd /= neigh.length;
    const lof = avgNeighLrd / myLrd;

    let level: 'normal' | 'mild' | 'outlier';
    if (lof < 1.2) level = 'normal';
    else if (lof < 2.0) level = 'mild';
    else level = 'outlier';

    results.push({ index: i, lof: Math.round(lof * 100) / 100, level, kDist: Math.round(kDists[i] * 1000) / 1000 });
  }

  results.sort((a, b) => b.lof - a.lof);
  return results;
}

export function lofColor(lof: number): string {
  if (lof < 1.2) return '#5aae6f';
  if (lof < 2.0) return '#f59e0b';
  return '#ef4444';
}
