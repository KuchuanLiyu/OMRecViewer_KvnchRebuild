/**
 * N-dimensional Mahalanobis distance from Pareto centroid.
 * Points far from center = extreme specialists (hard to optimize).
 * Points near center = balanced generalists (room to specialize).
 */

export function mahalanobisAnalysis(records: number[][]): {
  centroid: number[];
  cov: number[][];
  distances: number[];
  maxDist: number;
  minDist: number;
} {
  const n = records.length;
  const d = records[0]?.length ?? 0;
  if (n < 3 || d < 2) return { centroid: [], cov: [], distances: [], maxDist: 0, minDist: 0 };

  // Centroid
  const centroid = new Array(d).fill(0);
  for (const r of records) for (let j = 0; j < d; j++) centroid[j] += r[j];
  for (let j = 0; j < d; j++) centroid[j] /= n;

  // Covariance matrix
  const cov: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  for (const r of records) {
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        cov[i][j] += (r[i] - centroid[i]) * (r[j] - centroid[j]);
      }
    }
  }
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) cov[i][j] /= (n - 1);

  // Regularize: add small diagonal to avoid singular matrix
  for (let i = 0; i < d; i++) cov[i][i] += 1e-6;

  // Inverse via Cholesky (symmetric positive definite after regularization)
  const invCov = choleskyInvert(cov);
  if (!invCov) {
    // Fallback: use diagonal (normalized Euclidean)
    const distances = records.map(r => {
      let sum = 0;
      for (let j = 0; j < d; j++) sum += ((r[j] - centroid[j]) / Math.max(1, centroid[j])) ** 2;
      return Math.sqrt(sum);
    });
    const maxD = Math.max(...distances), minD = Math.min(...distances);
    return { centroid, cov, distances, maxDist: maxD, minDist: minD };
  }

  const distances = records.map(r => {
    let sum = 0;
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        sum += (r[i] - centroid[i]) * invCov[i][j] * (r[j] - centroid[j]);
      }
    }
    return Math.sqrt(Math.max(0, sum));
  });

  return {
    centroid,
    cov,
    distances,
    maxDist: Math.max(...distances),
    minDist: Math.min(...distances),
  };
}

/** Cholesky decomposition and inversion for small matrices */
function choleskyInvert(a: number[][]): number[][] | null {
  const n = a.length;
  const l: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i][j];
      for (let k = 0; k < j; k++) sum -= l[i][k] * l[j][k];
      if (i === j) {
        if (sum <= 0) return null;
        l[i][j] = Math.sqrt(sum);
      } else {
        l[i][j] = sum / l[j][j];
      }
    }
  }
  // Invert lower triangular
  const inv: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    inv[i][i] = 1 / l[i][i];
    for (let j = 0; j < i; j++) {
      let sum = 0;
      for (let k = j; k < i; k++) sum += l[i][k] * inv[k][j];
      inv[i][j] = -sum / l[i][i];
    }
  }
  // invCov = inv(L)' * inv(L)
  const result: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = Math.max(i, j); k < n; k++) sum += inv[k][i] * inv[k][j];
      result[i][j] = sum;
    }
  }
  return result;
}
