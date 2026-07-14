/**
 * Compute 2D ellipse from covariance submatrix.
 * Returns SVG path data for 1σ and 2σ confidence ellipses.
 */

export interface Ellipse2D {
  cx: number; cy: number;         // centroid in 2D
  path1sigma: string;             // SVG path for 1σ ellipse
  path2sigma: string;             // SVG path for 2σ ellipse
  label1sigma: { x: number; y: number }; // position for "1σ" label
  label2sigma: { x: number; y: number }; // position for "2σ" label
}

/** Compute ellipse from 2x2 covariance */
export function computeEllipse(
  cov2x2: number[][],  // 2x2 covariance submatrix
  center: [number, number]  // centroid in 2D
): Ellipse2D {
  const [cx, cy] = center;
  const [[a, b], [c, d]] = cov2x2;
  // Eigenvalues of 2x2 symmetric matrix
  const trace = a + d;
  const det = a * d - b * c;
  const disc = Math.sqrt(Math.max(0, trace * trace - 4 * det));
  const lambda1 = Math.sqrt((trace + disc) / 2); // semi-major axis
  const lambda2 = Math.sqrt(Math.max(0, (trace - disc) / 2)); // semi-minor axis

  // Eigenvector for λ1
  let angle = 0;
  if (Math.abs(b) > 1e-10 || Math.abs(c) > 1e-10) {
    const vx = lambda1 * lambda1 - d;
    const vy = b;
    angle = Math.atan2(vy, vx);
  }

  function ellipsePath(scale: number): string {
    const pts: string[] = [];
    const n = 64;
    for (let i = 0; i <= n; i++) {
      const theta = (i / n) * Math.PI * 2;
      const ex = lambda1 * scale * Math.cos(theta);
      const ey = lambda2 * scale * Math.sin(theta);
      const rx = ex * Math.cos(angle) - ey * Math.sin(angle) + cx;
      const ry = ex * Math.sin(angle) + ey * Math.cos(angle) + cy;
      pts.push(`${rx},${ry}`);
    }
    return pts.join(' ');
  }

  const angle1 = angle;
  return {
    cx, cy,
    path1sigma: ellipsePath(1),
    path2sigma: ellipsePath(2),
    label1sigma: {
      x: cx + lambda1 * 1 * Math.cos(angle1) * 1.1,
      y: cy + lambda1 * 1 * Math.sin(angle1) * 1.1,
    },
    label2sigma: {
      x: cx + lambda1 * 2 * Math.cos(angle1) * 1.05,
      y: cy + lambda1 * 2 * Math.sin(angle1) * 1.05,
    },
  };
}

/** Build 2x2 submatrix from n-dimensional covariance, selecting dimensions i and j */
export function subCov2x2(cov: number[][], i: number, j: number): number[][] {
  return [[cov[i][i], cov[i][j]], [cov[j][i], cov[j][j]]];
}
