<script setup lang="ts">
import { computed, ref } from "vue";

interface RadarAxisMeta {
  minVal: number;
  sumVal: number;
  sortedVals: number[];
}

interface RadarChartData {
  mode: string;
  axes: Record<string, RadarAxisMeta>;
  draftRaw: Record<string, number>;
}

const props = defineProps<{
  chartData: RadarChartData;
  puzzleName: string;
}>();

const svgRef = ref<SVGElement | null>(null);
const isCopying = ref(false);

const SCHEMES = ["cyan", "amber", "purple", "emerald", "crimson", "ocean"] as const;
const schemeIndex = ref(1); // 默认 amber
const colorScheme = computed(() => SCHEMES[schemeIndex.value]);

function cycleScheme() {
  schemeIndex.value = (schemeIndex.value + 1) % SCHEMES.length;
}

const CENTER_X = 240;
const CENTER_Y = 260;
const MAX_RADIUS = 155;

/** 幂函数（Gamma 模型）全段平滑拟合
 *  xMin → 1.0,  xSum → 0.75,  公式: 1 - 0.25 * ((x-xMin)/(xSum-xMin))^γ */
/** 两段式: x≤xSum 指数(1.0→0.5), x>xSum 排名线性(0.5→0.0) */
function computePowerScore(x: number, xMin: number, xSum: number, sortedVals: number[]): number {
  if (x <= xMin) return 1.0;
  const ratio = (x - xMin) / (xSum - xMin);

  if (x <= xSum) {
    return Math.exp(-0.693 * ratio);
  }

  const above = sortedVals.filter(v => v > xSum);
  if (above.length === 0) return 0.5;
  let rank = above.findIndex(v => v >= x);
  if (rank < 0) rank = above.length - 1;
  return 0.5 * (1.0 - rank / (above.length - 1 || 1));
}

function getCoordinates(angle: number, score: number) {
  const r = score * MAX_RADIUS;
  return {
    x: CENTER_X + r * Math.cos(angle),
    y: CENTER_Y + r * Math.sin(angle)
  };
}

const SHORT_NAMES: Record<string, string> = {
  cycles: "C", cost: "G", area: "A", instructions: "I",
  height: "H", width: "W", boundingHex: "B", rate: "R",
};

const MASTER_ORDER = ["cycles", "cost", "area", "instructions", "height", "width", "boundingHex", "rate"];

const parsedAxes = computed(() => {
  const availableKeys = MASTER_ORDER.filter(key => props.chartData.axes[key] !== undefined);
  const count = availableKeys.length;

  return availableKeys.map((key, i) => {
    const angle = (i * 2 * Math.PI) / count - Math.PI / 2;
    const meta = props.chartData.axes[key];
    const rawVal = props.chartData.draftRaw[key];

    const score = rawVal !== undefined ? computePowerScore(rawVal, meta.minVal, meta.sumVal, meta.sortedVals) : 0;
    const endCoords = getCoordinates(angle, 1.0);
    const labelCoords = getCoordinates(angle, 1.28);

    return {
      key: SHORT_NAMES[key] || key.toUpperCase(),
      angle,
      score,
      endX: endCoords.x,
      endY: endCoords.y,
      labelX: labelCoords.x,
      labelY: labelCoords.y,
      displayVal: rawVal !== undefined ? rawVal : "—"
    };
  });
});

const draftPolygonPoints = computed(() => {
  return parsedAxes.value.map(a => {
    const c = getCoordinates(a.angle, a.score);
    return `${c.x},${c.y}`;
  }).join(" ");
});

function getRingPoints(ringScore: number): string {
  return parsedAxes.value.map(a => {
    const c = getCoordinates(a.angle, ringScore);
    return `${c.x},${c.y}`;
  }).join(" ");
}

async function copyChartToClipboard() {
  if (!svgRef.value || isCopying.value) return;
  isCopying.value = true;

  try {
    const svgElement = svgRef.value;
    const serializer = new XMLSerializer();
    let svgString = serializer.serializeToString(svgElement);

    // 动态读取当前配色
    const cs = getComputedStyle(svgElement);
    const cssStyles = `
      text { font-family: Georgia, 'Times New Roman', serif; }
      .title-text { fill: ${cs.getPropertyValue("--radar-primary")}; font-size: 12px; font-weight: bold; font-family: Georgia, serif; letter-spacing: 1px; }
      .grid-ring { fill: none; stroke: ${cs.getPropertyValue("--radar-grid")}; stroke-width: 1; }
      .grid-ring-dim { opacity: 0.4; }
      .sum-baseline-ring { fill: none; stroke: ${cs.getPropertyValue("--radar-primary")}; stroke-dasharray: 4 3; stroke-width: 1.3; opacity: 0.8; }
      .axis-line { stroke: ${cs.getPropertyValue("--radar-axis")}; stroke-width: 0.8; opacity: 0.7; }
      .axis-label { fill: ${cs.getPropertyValue("--radar-label")}; font-size: 9px; font-family: Georgia, serif; }
      .draft-poly { fill: ${cs.getPropertyValue("--radar-poly-fill")}; stroke: ${cs.getPropertyValue("--radar-poly-stroke")}; stroke-width: 2; stroke-linejoin: round; }
      .vertex-dot { fill: ${cs.getPropertyValue("--radar-accent")}; stroke: #1a1a1a; stroke-width: 0.8; opacity: 0.7; }
      .center-dot { fill: ${cs.getPropertyValue("--radar-primary")}; opacity: 0.5; }
    `;
    svgString = svgString.replace(/<svg[^>]*>/, `$&<style>${cssStyles}</style>`);

    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const URL = window.URL || window.webkitURL || window;
    const blobURL = URL.createObjectURL(svgBlob);

    const image = new Image();
    image.src = blobURL;

    image.onload = async () => {
      const SCALE_FACTOR = 3;
      const canvas = document.createElement("canvas");
      canvas.width = 480 * SCALE_FACTOR;
      canvas.height = 480 * SCALE_FACTOR;
      const context = canvas.getContext("2d");

      if (context) {
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.scale(SCALE_FACTOR, SCALE_FACTOR);
        context.drawImage(image, 0, 0);
        canvas.toBlob(async (pngBlob) => {
          if (pngBlob) {
            try {
              await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
            } catch (err) { console.error(err); }
          }
          URL.revokeObjectURL(blobURL);
        }, "image/png");
      }
    };
  } catch (e) {
    console.error(e);
  } finally {
    isCopying.value = false;
  }
}
</script>

<template>
  <div class="radar-wrapper" :data-scheme="colorScheme">
    <div class="radar-header">
      <span class="panel-tag">QUANTUM MATRIX PROFILE</span>
      <div class="radar-actions">
        <button @click="cycleScheme" class="btn-scheme" :title="colorScheme">{{ colorScheme.toUpperCase() }}</button>
        <button @click="copyChartToClipboard" class="btn-copy" :disabled="isCopying">
          {{ isCopying ? 'GENERATING...' : 'COPY IMAGE' }}
        </button>
      </div>
    </div>

    <svg viewBox="0 0 480 480" width="480" height="480" ref="svgRef" class="radar-svg">
      <defs>
        <radialGradient id="bg-grad" cx="50%" cy="55%" r="50%">
          <stop offset="0%" stop-color="#2d2d2d" />
          <stop offset="100%" stop-color="#1a1a1a" />
        </radialGradient>
        <linearGradient id="poly-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="var(--radar-accent)" stop-opacity="0.25" />
          <stop offset="100%" stop-color="var(--radar-accent)" stop-opacity="0.05" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      <rect width="480" height="480" fill="url(#bg-grad)" />

      <text x="20" y="28" class="title-text">{{ puzzleName.toUpperCase() }}</text>

      <polygon
        v-for="ring in [0.25, 0.5, 0.75, 1.0]"
        :key="ring"
        :points="getRingPoints(ring)"
        :class="['grid-ring', ring === 0.5 ? 'sum-baseline-ring' : '', ring === 0.25 || ring === 0.75 ? 'grid-ring-dim' : '']"
      />
      <circle :cx="CENTER_X" :cy="CENTER_Y" r="2" class="center-dot" />

      <g v-for="axis in parsedAxes" :key="axis.key">
        <line :x1="CENTER_X" :y1="CENTER_Y" :x2="axis.endX" :y2="axis.endY" class="axis-line" />
        <text :x="axis.labelX" :y="axis.labelY" class="axis-label">
          {{ axis.key }}:{{ axis.displayVal }}
        </text>
      </g>

      <polygon v-if="draftPolygonPoints.trim()" :points="draftPolygonPoints" class="draft-poly" filter="url(#glow)" />
      <circle v-for="(a, i) in parsedAxes" :key="'dot'+i" :cx="getCoordinates(a.angle, a.score).x" :cy="getCoordinates(a.angle, a.score).y" r="1.8" class="vertex-dot" />
    </svg>
  </div>
</template>

<style scoped>
.radar-wrapper { display: flex; flex-direction: column; background: var(--bg-deep); border: 1px solid var(--border-color); border-radius: 4px; padding: 16px; width: 480px; flex-shrink: 0; user-select: none;
  --radar-accent: #e0c070; --radar-primary: #c0a060;
  --radar-grid: #2d2d2d; --radar-axis: #3d3d3d; --radar-label: #6a6a6a;
  --radar-poly-fill: rgba(224, 192, 112, 0.14); --radar-poly-stroke: var(--radar-accent);
}
.radar-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.panel-tag { font-size: 0.6rem; color: var(--color-text-muted); font-weight: bold; letter-spacing: 0.5px; font-family: 'Crimson Text', serif; }
.radar-actions { display: flex; gap: 4px; align-items: center; }
.btn-scheme { background: transparent; border: 1px solid #4e5d78; color: #4e5d78; font-family: monospace; font-size: 0.55rem; padding: 2px 5px; border-radius: 3px; cursor: pointer; text-transform: uppercase; }
.btn-scheme:hover { border-color: #fff; color: #fff; }
.btn-copy { background: transparent; border: 1px solid var(--color-primary); color: var(--color-primary); font-family: monospace; font-size: 0.65rem; padding: 2px 6px; border-radius: 3px; cursor: pointer; }
.btn-copy:hover { background: var(--color-primary); color: #000; }
.btn-copy:disabled { opacity: 0.5; }

.radar-svg { width: 100%; overflow: visible; }
.center-dot { fill: var(--radar-primary); opacity: 0.5; }
.title-text { fill: var(--radar-primary); font-size: 11px; font-weight: bold; font-family: 'Cinzel', Georgia, serif; letter-spacing: 1px; opacity: 0.9; }
.grid-ring { fill: none; stroke: var(--radar-grid); stroke-width: 1; }
.grid-ring-dim { opacity: 0.4; }
.sum-baseline-ring { stroke: var(--radar-primary); stroke-dasharray: 4 3; stroke-width: 1.3; opacity: 0.8; }
.axis-line { stroke: var(--radar-axis); stroke-width: 0.8; opacity: 0.7; }
.axis-label { fill: var(--radar-label); font-size: 8.5px; font-family: 'Crimson Text', Georgia, serif; text-anchor: middle; dominant-baseline: middle; }
.draft-poly { fill: url(#poly-grad); stroke: var(--radar-poly-stroke); stroke-width: 2; stroke-linejoin: round; }
.vertex-dot { fill: var(--radar-accent); stroke: var(--bg-deep); stroke-width: 0.8; opacity: 0.7; }

/* ── 配色方案 ── */
.radar-wrapper[data-scheme="cyan"] {
  --radar-accent: #90d0d8; --radar-primary: #70a0a8;
  --radar-poly-fill: rgba(144, 208, 216, 0.14);
}
.radar-wrapper[data-scheme="amber"] {
  --radar-accent: #e0c070; --radar-primary: #c0a060;
  --radar-poly-fill: rgba(224, 192, 112, 0.14);
}
.radar-wrapper[data-scheme="purple"] {
  --radar-accent: #c084fc; --radar-primary: #a78bfa;
  --radar-poly-fill: rgba(192, 132, 252, 0.14);
}
.radar-wrapper[data-scheme="emerald"] {
  --radar-accent: #6ee7b7; --radar-primary: #34d399;
  --radar-poly-fill: rgba(110, 231, 183, 0.14);
}

.grid-ring { fill: none; stroke: var(--radar-grid); stroke-width: 1; }
.sum-baseline-ring { stroke: var(--radar-primary); stroke-dasharray: 4 3; stroke-width: 1.2; }
.axis-line { stroke: var(--radar-axis); stroke-width: 1; }
.axis-label { fill: var(--radar-label); font-size: 9px; font-family: monospace; text-anchor: middle; dominant-baseline: middle; }
.draft-poly { fill: var(--radar-poly-fill); stroke: var(--radar-poly-stroke); stroke-width: 1.8; }
</style>
