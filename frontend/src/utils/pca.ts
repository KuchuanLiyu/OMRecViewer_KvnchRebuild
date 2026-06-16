/**
 * PCA: reduce n-dimensional points to 2 principal components.
 * Returns projected points + variance explained by each component.
 */
export function pcaProject(vectors: number[][]): {
  projected: [number, number][];
  varPct: [number, number];
} {
  const n = vectors.length;
  const d = vectors[0]?.length ?? 0;
  if (n < 2 || d < 2) return { projected: [], varPct: [0, 0] };

  // Center the data
  const mean = new Array(d).fill(0);
  for (const v of vectors) for (let j = 0; j < d; j++) mean[j] += v[j];
  for (let j = 0; j < d; j++) mean[j] /= n;

  const centered = vectors.map(v => v.map((x, j) => x - mean[j]));

  // Covariance matrix
  const cov: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  for (const v of centered) {
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        cov[i][j] += v[i] * v[j];
      }
    }
  }
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) cov[i][j] /= (n - 1);

  // Power iteration for top 2 eigenvectors & eigenvalues
  const { vec: v1, val: lambda1 } = powerIter(cov);
  // Deflate: remove v1 component from cov
  const cov2 = cov.map((row, i) => row.map((c, j) => c - lambda1 * v1[i] * v1[j]));
  const { vec: v2, val: lambda2 } = powerIter(cov2);

  const totalVar = cov.reduce((s, row, i) => s + row[i], 0);
  const varPct: [number, number] = [
    Math.round(lambda1 / totalVar * 100),
    Math.round(lambda2 / totalVar * 100),
  ];

  const projected: [number, number][] = vectors.map(v => {
    let pc1 = 0, pc2 = 0;
    for (let j = 0; j < d; j++) {
      pc1 += (v[j] - mean[j]) * v1[j];
      pc2 += (v[j] - mean[j]) * v2[j];
    }
    return [pc1, pc2];
  });

  return { projected, varPct };
}

function powerIter(mat: number[][], maxIter = 50): { vec: number[]; val: number } {
  const d = mat.length;
  let vec = new Array(d).fill(1 / Math.sqrt(d));
  for (let iter = 0; iter < maxIter; iter++) {
    const next = new Array(d).fill(0);
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) next[i] += mat[i][j] * vec[j];
    }
    const norm = Math.sqrt(next.reduce((s, x) => s + x * x, 0));
    if (norm < 1e-10) break;
    vec = next.map(x => x / norm);
  }
  const Av = new Array(d).fill(0);
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) Av[i] += mat[i][j] * vec[j];
  const val = vec.reduce((s, vi, i) => s + vi * Av[i], 0);
  return { vec, val: Math.max(0, val) };
}
