import type { OmScoreDTO } from "../types/om";

export function getRaw(s: OmScoreDTO, key: string): number | null {
  switch (key) {
    case "cost": return s.cost;
    case "cycles": return s.cycles;
    case "area": return s.area;
    case "instructions": return s.instructions;
    case "height": return s.height ?? null;
    case "width": return s.width != null ? Math.round(s.width) : null;
    case "boundingHex": return s.boundingHex ?? null;
    case "rate": return s.rate != null ? Math.round(s.rate) : null;
    default: return null;
  }
}

export const METRIC_LABELS: Record<string, string> = {
  cost: "G", cycles: "C", area: "A", instructions: "I",
  height: "H", width: "W", boundingHex: "B", rate: "R",
};
