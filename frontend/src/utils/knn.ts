/**
 * KNN Isolation Detection — computes how isolated each point is in multi-dimensional space.
 * Higher isolation = farther from neighbors = potentially interesting outlier.
 */

export interface KnnResult {
  /** Point index (same order as input) */
  index: number;
  /** Average distance to k-nearest neighbors (raw) */
  avgDist: number;
  /** Normalized isolation score 0-100 (higher = more isolated) */
  isolation: number;
  /** Indices of the k nearest neighbors */
  neighbors: number[];
  /** Isolation level for coloring */
  level: 'clustered' | 'normal' | 'isolated';
}

/**
 * Compute KNN isolation scores for a set of multi-dimensional points.
 * @param points  Array of vectors (each must have same length)
 * @param k       Number of neighbors (default = min(5, n-1))
 * @returns Isolation result for each point, sorted by isolation descending
 */
export function knnIsolation(points: number[][], k?: number): KnnResult[] {
  const n = points.length;
  if (n < 2) return points.map((_, i) => ({
    index: i, avgDist: 0, isolation: 50, neighbors: [], level: 'normal' as const,
  }));

  const kn = k ?? Math.min(5, n - 1);
  const dim = points[0].length;

  // Compute all pairwise Euclidean distances
  const distMatrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let sum = 0;
      for (let d = 0; d < dim; d++) {
        const diff = points[i][d] - points[j][d];
        sum += diff * diff;
      }
      const dist = Math.sqrt(sum);
      distMatrix[i][j] = dist;
      distMatrix[j][i] = dist;
    }
  }

  // For each point, find k nearest neighbors and average distance
  const results: KnnResult[] = [];
  const rawDists: number[] = [];

  for (let i = 0; i < n; i++) {
    const neighbors = Array.from({ length: n }, (_, j) => ({ index: j, dist: distMatrix[i][j] }))
      .filter(x => x.index !== i && isFinite(x.dist))
      .sort((a, b) => a.dist - b.dist);

    const knn = neighbors.slice(0, kn);
    const avgDist = knn.length > 0
      ? knn.reduce((s, x) => s + x.dist, 0) / knn.length
      : 0;

    rawDists.push(avgDist);
    results.push({
      index: i,
      avgDist: Math.round(avgDist * 1000) / 1000,
      isolation: 0, // filled after normalization
      neighbors: knn.map(x => x.index),
      level: 'normal',
    });
  }

  // Normalize isolation to 0-100
  const minD = Math.min(...rawDists);
  const maxD = Math.max(...rawDists);
  const range = maxD - minD;

  for (let i = 0; i < n; i++) {
    const raw = rawDists[i];
    const isolation = range > 1e-9 ? Math.round((raw - minD) / range * 100) : 50;

    let level: 'clustered' | 'normal' | 'isolated';
    if (isolation <= 33) level = 'clustered';
    else if (isolation <= 66) level = 'normal';
    else level = 'isolated';

    results[i].isolation = isolation;
    results[i].level = level;
  }

  // Sort: most isolated first
  results.sort((a, b) => b.isolation - a.isolation);

  return results;
}

/** Color based on isolation level (for 3D / SVG). */
export function isolationColor(isolation: number): string {
  if (isolation <= 33) return '#5a9e6f';  // green: well-clustered
  if (isolation <= 66) return '#ffb703';  // gold: normal
  return '#c44b3c';                        // red: isolated outlier
}

/** Map isolation score to a sphere radius scale factor (3D). */
export function isolationRadius(isolation: number): number {
  // More isolated = slightly larger sphere
  if (isolation <= 33) return 1.0;
  if (isolation <= 66) return 1.3;
  return 1.7;
}
