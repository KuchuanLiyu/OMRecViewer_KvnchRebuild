<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import * as echarts from "echarts";
import type { OmRecordDTO } from "../types/om";
import { getRaw, METRIC_LABELS } from "../utils/metrics";
import { convexHull, findGaps, computeWeaknessScore, type Point2D, type HullGap } from "../utils/convexHull";
import { splineHull } from "../utils/spline";
import { t } from "../utils/i18n";

const props = defineProps<{ allRecords: OmRecordDTO[] }>();

const avail = computed(() => {
  const s = new Set<string>();
  for (const r of props.allRecords) {
    for (const k of ["cost","cycles","area","instructions","height","width","boundingHex","rate"]) {
      if (r.score && getRaw(r.score, k) != null) s.add(k);
    }
  }
  return [...s];
});

const dimX = ref("cost");
const dimY = ref("cycles");
const showGaps = ref(true);
const hoveredId = ref<string | null>(null);

const chartContainer = ref<HTMLDivElement | null>(null);
let chartInst: echarts.ECharts | null = null;

interface ProjResult {
  dims: string[]; hull: Point2D[]; gaps: HullGap[]; pareto: Point2D[]; all: Point2D[];
  paretoIdx: Map<string, number>;
}
const currentProj = ref<ProjResult | null>(null);
const weaknessList = ref<{ id: string; score: number; label: string; recId: string }[]>([]);

function runAnalysis() {
  const scored = props.allRecords.filter(r => r.score != null);
  if (scored.length < 3) return;

  const x = dimX.value, y = dimY.value;
  const allPts: Point2D[] = scored.map(r => ({
    x: getRaw(r.score!, x)!, y: getRaw(r.score!, y)!, id: r.id ?? undefined,
  })).filter(p => p.x != null && p.y != null);

  const paretoPts = allPts.filter(p => {
    const rec = scored.find(r => r.id === p.id);
    if (!rec) return false;
    return !scored.some(o =>
      o !== rec && o.score!.cost <= rec.score!.cost && o.score!.cycles <= rec.score!.cycles &&
      o.score!.area <= rec.score!.area &&
      (o.score!.cost < rec.score!.cost || o.score!.cycles < rec.score!.cycles || o.score!.area < rec.score!.area)
    );
  });

  const hull = convexHull(paretoPts);
  const maxGap = Math.max(...hull.map((p, i) => {
    const q = hull[(i + 1) % hull.length];
    return Math.sqrt((q.x - p.x) ** 2 + (q.y - p.y) ** 2);
  }));
  const gaps = findGaps(hull, maxGap * 0.15);

  const paretoIdx = new Map<string, number>();
  for (const [i, h] of hull.entries()) {
    for (const pp of paretoPts) {
      if (pp.id && Math.abs(pp.x - h.x) < 0.01 && Math.abs(pp.y - h.y) < 0.01) {
        paretoIdx.set(pp.id, i);
      }
    }
  }

  currentProj.value = { dims: [x, y], hull, gaps, pareto: paretoPts, all: allPts, paretoIdx };

  const allPairs = [
    ["cost","cycles"],["cost","area"],["cost","instructions"],
    ["cycles","area"],["cycles","instructions"],["area","instructions"],
  ];
  if (avail.value.includes("height")) allPairs.push(["cost","height"],["cycles","height"]);
  if (avail.value.includes("rate")) allPairs.push(["cycles","rate"]);

  const projections = allPairs.map(([dx, dy]) => {
    const pts = scored.map(r => ({ x: getRaw(r.score!, dx)!, y: getRaw(r.score!, dy)! })).filter(p => p.x != null && p.y != null);
    return { dims: [dx, dy], hull: convexHull(pts) };
  });

  weaknessList.value = paretoPts.map(p => {
    const score = computeWeaknessScore(p, projections);
    const rec = scored.find(r => r.id === p.id);
    const label = rec ? `${rec.score!.cost}g/${rec.score!.cycles}c/${rec.score!.area}a` : "";
    return { id: p.id ?? "", score: score.score, label, recId: rec?.id ?? "" };
  }).filter(w => w.score > 0).sort((a, b) => b.score - a.score).slice(0, 15);

  nextTick(() => renderChart());
}

let baseChartOption: any = null;

function renderChart() {
  if (!chartContainer.value || !currentProj.value) return;
  if (chartInst && chartInst.getDom() !== chartContainer.value) { chartInst.dispose(); chartInst = null; }
  if (!chartInst) chartInst = echarts.init(chartContainer.value);

  const { hull, gaps, pareto, all, dims } = currentProj.value;
  const [dx, dy] = dims;
  const xLabel = METRIC_LABELS[dx] || dx;
  const yLabel = METRIC_LABELS[dy] || dy;

  const splinePts = splineHull(hull, 20);

  baseChartOption = {
    tooltip: { trigger: "item", backgroundColor: "#181510", borderColor: "#5a4a2a", textStyle: { color: "#e0d8c8", fontSize: 11 } },
    xAxis: { name: xLabel, nameLocation: "center", nameGap: 30, nameTextStyle: { color: "#807860", fontFamily: "Cinzel" }, axisLine: { lineStyle: { color: "#332d22" } }, splitLine: { lineStyle: { color: "#221d17" } } },
    yAxis: { name: yLabel, nameLocation: "center", nameGap: 40, nameTextStyle: { color: "#807860", fontFamily: "Cinzel" }, axisLine: { lineStyle: { color: "#332d22" } }, splitLine: { lineStyle: { color: "#221d17" } } },
    series: [
      { id: "all", type: "scatter", data: all.map(p => [p.x, p.y]), symbolSize: 3, itemStyle: { color: "#3a3228", opacity: 0.4 } },
      { id: "curve", type: "line", data: splinePts, symbol: "none", smooth: false, lineStyle: { color: "#c44b3c", width: 2.5 }, z: 1 },
      { id: "pareto", type: "scatter", data: pareto.map(p => [p.x, p.y]), symbolSize: 6, itemStyle: { color: "#c9a84c" }, z: 2 },
      { id: "hl0", type: "line", data: [], lineStyle: { color: "#ffb703", width: 3 }, z: 3 },
      { id: "hl1", type: "line", data: [], lineStyle: { color: "#ffb703", width: 3 }, z: 3 },
      ...(showGaps.value ? gaps.map((g, i) => ({
        id: `gap${i}`, type: "scatter" as const,
        data: [[g.midpoint.x, g.midpoint.y]],
        symbolSize: 10, symbol: "diamond",
        itemStyle: { color: "#5a9e6f", opacity: 0.7 },
        z: 1,
      })) : []),
    ],
  };
  chartInst.clear();
  chartInst.setOption(baseChartOption, { notMerge: true });
}

function highlightPoint(pid: string | null) {
  if (!chartInst || !currentProj.value) return;
  const { hull, pareto, paretoIdx } = currentProj.value;

  if (!pid || !paretoIdx.has(pid)) {
    chartInst.setOption({
      series: [
        { id: "pareto", data: pareto.map(p => [p.x, p.y]), symbolSize: 6, itemStyle: { color: "#c9a84c", shadowBlur: 0 } },
        { id: "hl0", data: [] },
        { id: "hl1", data: [] },
      ],
    }, true);
    return;
  }

  const idx = paretoIdx.get(pid)!;
  const prev = (idx - 1 + hull.length) % hull.length;
  const next = (idx + 1) % hull.length;

  chartInst.setOption({
    series: [
      { id: "pareto", data: pareto.map(p => {
        const isHL = p.id === pid;
        return { value: [p.x, p.y], symbolSize: isHL ? 14 : 6, itemStyle: { color: isHL ? "#ffb703" : "#c9a84c", shadowBlur: isHL ? 12 : 0, shadowColor: isHL ? "#ffb703" : "transparent" } };
      }) },
      { id: "hl0", data: [[hull[prev].x, hull[prev].y], [hull[idx].x, hull[idx].y]] },
      { id: "hl1", data: [[hull[idx].x, hull[idx].y], [hull[next].x, hull[next].y]] },
    ],
  }, true);
}

function onWeakHover(w: { id: string }) { hoveredId.value = w.id; highlightPoint(w.id); }
function onWeakLeave() { hoveredId.value = null; highlightPoint(null); }

watch([() => props.allRecords, dimX, dimY, showGaps], () => {
  if (props.allRecords.length > 0) runAnalysis();
}, { immediate: true });
</script>

<template>
  <div class="hull-container">
    <div class="hull-header">
      <span class="hull-title">{{ t('hull_title') }}</span>
      <span class="hull-sub">{{ avail.length }} {{ t('hull_sub') }}</span>
    </div>

    <div class="hull-controls">
      <div class="control-pair"><label>{{ t('hull_x_axis') }}</label><select v-model="dimX"><option v-for="k in avail" :key="k" :value="k">{{ METRIC_LABELS[k] }}</option></select></div>
      <div class="control-pair"><label>{{ t('hull_y_axis') }}</label><select v-model="dimY"><option v-for="k in avail" :key="k" :value="k">{{ METRIC_LABELS[k] }}</option></select></div>
      <label class="gap-toggle"><input type="checkbox" v-model="showGaps" /> {{ t('hull_show_gaps') }}</label>
    </div>

    <div class="hull-grid">
      <div class="hull-chart-wrap"><div ref="chartContainer" class="hull-chart"></div></div>
      <div class="weakness-panel">
        <div class="weakness-title">{{ t('hull_weakness_title') }}</div>
        <div class="weakness-desc">{{ t('hull_weakness_desc') }}</div>
        <div v-for="w in weaknessList" :key="w.id" class="weak-row"
             :class="{ hovered: hoveredId === w.id }"
             @mouseenter="onWeakHover(w)" @mouseleave="onWeakLeave">
          <span class="weak-rank">{{ w.score }}/{{ Math.min(10, (avail.length*(avail.length-1))/2) || 1 }}</span>
          <span class="weak-label">{{ w.label }}</span>
          <span v-if="w.score >= 3" class="weak-tag">{{ t('hull_priority') }}</span>
        </div>
        <div v-if="weaknessList.length === 0" class="weak-none">{{ t('hull_empty') }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hull-container { padding: 16px 20px; max-width: 1100px; margin: 0 auto; color: #e0d8c8; font-family: 'JetBrains Mono', monospace; }
.hull-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; }
.hull-title { color: #c9a84c; font-size: 0.82rem; font-weight: 700; font-family: 'Cinzel', serif; letter-spacing: 2px; }
.hull-sub { color: #807860; font-size: 0.64rem; }

.hull-controls { display: flex; gap: 16px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.control-pair { display: flex; align-items: center; gap: 6px; }
.control-pair label { color: #807860; font-size: 0.66rem; font-family: 'Cinzel', serif; letter-spacing: 1px; }
.control-pair select {
  background: rgba(0,0,0,0.2); color: #e0d8c8;
  border: 1px solid rgba(255,255,255,0.08); padding: 4px 8px; border-radius: 6px;
  font-family: 'JetBrains Mono', monospace; font-size: 0.68rem; outline: none; cursor: pointer;
  transition: border-color 0.2s ease;
}
.control-pair select:focus { border-color: #c9a84c; }
.gap-toggle { display: flex; align-items: center; gap: 4px; color: #807860; font-size: 0.66rem; cursor: pointer; }
.gap-toggle input { accent-color: #c9a84c; }

.hull-grid { display: grid; grid-template-columns: 1fr 260px; gap: 12px; }
.hull-chart-wrap {
  background: rgba(26,23,18,0.5); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px; padding: 8px;
}
.hull-chart { width: 100%; height: 420px; }

.weakness-panel {
  background: rgba(26,23,18,0.5); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px; padding: 12px; max-height: 440px; overflow-y: auto;
}
.weakness-title { color: #d45a4a; font-size: 0.66rem; font-weight: 600; font-family: 'Cinzel', serif; letter-spacing: 1px; margin-bottom: 4px; }
.weakness-desc { color: #807860; font-size: 0.62rem; margin-bottom: 8px; line-height: 1.4; }
.weak-row {
  display: flex; align-items: center; gap: 6px; padding: 4px 6px;
  border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.62rem;
  cursor: pointer; border-radius: 4px; transition: background 0.15s ease;
}
.weak-row:hover, .weak-row.hovered { background: rgba(201,168,76,0.06); }
.weak-rank { color: #d45a4a; font-weight: 600; min-width: 30px; }
.weak-label { color: #e0d8c8; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.weak-tag { background: rgba(212,90,74,0.15); color: #d45a4a; font-size: 0.62rem; padding: 2px 5px; border-radius: 4px; font-weight: 600; }
.weak-none { color: #807860; font-size: 0.66rem; font-style: italic; line-height: 1.4; }
</style>
