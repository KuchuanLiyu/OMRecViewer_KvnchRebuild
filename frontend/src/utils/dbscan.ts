/**
 * DBSCAN — Density-Based Spatial Clustering of Applications with Noise.
 * Auto-estimates eps from average k-distance if not provided.
 */

export interface DbscanResult {
  index: number;
  cluster: number;   // -1 = noise, 0+ = cluster ID
  isCore: boolean;
}

export function dbscan(
  points: number[][],
  eps?: number,
  minPts?: number
): { clusters: DbscanResult[]; eps: number; clusterCount: number } {
  const n = points.length;
  if (n < 2) return { clusters: points.map((_, i) => ({ index: i, cluster: -1, isCore: false })), eps: eps ?? 0, clusterCount: 0 };

  const mp = minPts ?? Math.max(3, Math.min(6, Math.floor(Math.sqrt(n))));
  const dim = points[0].length;

  const dist = (i: number, j: number): number => {
    let sum = 0;
    for (let d = 0; d < dim; d++) sum += (points[i][d] - points[j][d]) ** 2;
    return Math.sqrt(sum);
  };

  // Auto-estimate eps: k-distance elbow (average of 4th-nearest distances * 0.75)
  let epsAuto = eps;
  if (!epsAuto) {
    const kDist: number[] = [];
    for (let i = 0; i < n; i++) {
      const dists: number[] = [];
      for (let j = 0; j < n; j++) if (i !== j) dists.push(dist(i, j));
      dists.sort((a, b) => a - b);
      kDist.push(dists[Math.min(mp - 1, dists.length - 1)]);
    }
    kDist.sort((a, b) => a - b);
    epsAuto = kDist[Math.floor(n * 0.75)] * 0.8; // 75th percentile * 0.8
    if (epsAuto < 0.001) epsAuto = 0.1;
  }

  // Find neighbors within eps
  const regionQuery = (i: number): number[] => {
    const result: number[] = [];
    for (let j = 0; j < n; j++) {
      if (i !== j && dist(i, j) <= epsAuto!) result.push(j);
    }
    return result;
  };

  const visited = new Array(n).fill(false);
  const clusterLabels = new Array(n).fill(-1);
  const isCore = new Array(n).fill(false);
  let clusterId = 0;

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    visited[i] = true;
    const neighbors = regionQuery(i);

    if (neighbors.length < mp) {
      clusterLabels[i] = -1; // noise
    } else {
      isCore[i] = true;
      clusterLabels[i] = clusterId;
      // Expand cluster
      const seeds = [...neighbors];
      let si = 0;
      while (si < seeds.length) {
        const p = seeds[si];
        if (!visited[p]) {
          visited[p] = true;
          const pNeighbors = regionQuery(p);
          if (pNeighbors.length >= mp) {
            isCore[p] = true;
            for (const pn of pNeighbors) {
              if (!seeds.includes(pn)) seeds.push(pn);
            }
          }
        }
        if (clusterLabels[p] === -1) {
          clusterLabels[p] = clusterId;
        }
        si++;
      }
      clusterId++;
    }
  }

  return {
    clusters: Array.from({ length: n }, (_, i) => ({
      index: i, cluster: clusterLabels[i], isCore: isCore[i],
    })),
    eps: epsAuto,
    clusterCount: clusterId,
  };
}

/** Distinct colors for up to 12 clusters. */
const CLUSTER_COLORS = [
  '#818cf8', '#f59e0b', '#22c55e', '#ef4444', '#06b6d4',
  '#ec4899', '#84cc16', '#f97316', '#14b8a6', '#a855f7',
  '#eab308', '#6366f1',
];

export function clusterColor(clusterId: number): string {
  if (clusterId < 0) return '#3a3228'; // noise → dark gray
  return CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length];
}
