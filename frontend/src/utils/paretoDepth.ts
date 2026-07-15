/**
 * Pareto Depth — compute dominance layers.
 * Layer 0 = true Pareto frontier.
 * Layer 1 = dominated only by layer 0.
 * Layer N = dominated by layers 0..N-1.
 */

export interface DepthResult {
  index: number;
  depth: number;      // 0 = on frontier, higher = farther from frontier
  label: string;      // "Pareto", "Layer 1", "Layer 2", ...
}

/** Returns depth for each record. Input must have cost/cycles/area. */
export function computeParetoDepth(
  records: { cost: number; cycles: number; area: number }[]
): DepthResult[] {
  const n = records.length;
  // dominated[i] = set of records that dominate record i
  const dominatedBy: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    const a = records[i];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const b = records[j];
      // b dominates a?
      if (b.cost <= a.cost && b.cycles <= a.cycles && b.area <= a.area &&
          (b.cost < a.cost || b.cycles < a.cycles || b.area < a.area)) {
        dominatedBy[i].push(j);
      }
    }
  }

  // Compute depth layers: assign depth = 1 + max(depth of dominators)
  const depth: number[] = new Array(n).fill(-1);

  function getDepth(i: number): number {
    if (depth[i] >= 0) return depth[i];
    if (dominatedBy[i].length === 0) {
      depth[i] = 0; // Pareto frontier
      return 0;
    }
    let maxD = 0;
    for (const j of dominatedBy[i]) {
      maxD = Math.max(maxD, getDepth(j));
    }
    depth[i] = maxD + 1;
    return depth[i];
  }

  const results: DepthResult[] = [];
  for (let i = 0; i < n; i++) {
    const d = getDepth(i);
    results.push({
      index: i,
      depth: d,
      label: d === 0 ? 'Pareto' : `Layer ${d}`,
    });
  }

  return results;
}
