<script setup lang="ts">
import { ref, computed, nextTick, watch } from "vue";
import * as echarts from "echarts";
import type { OmRecordDTO, OmScoreDTO } from "../types/om";
import { getRaw, METRIC_LABELS } from "../utils/metrics";
import { t } from "../utils/i18n";

const props = defineProps<{ allRecords: OmRecordDTO[] }>();

interface MetricDef { key: string; label: string; value: number | null }
const metrics = ref<MetricDef[]>([]);
const analyzed = ref(false);

// ── 从 records 检测可用指标 ──
function detectMetrics(): MetricDef[] {
  const seen = new Set<string>();
  const result: MetricDef[] = [];
  const order = ["cost","cycles","area","instructions","height","width","boundingHex","rate"];
  for (const k of order) {
    for (const r of props.allRecords) {
      if (!r.score) continue;
      const v = getRaw(r.score, k);
      if (v != null && !seen.has(k)) {
        seen.add(k);
        result.push({ key: k, label: METRIC_LABELS[k] || k, value: null });
        break;
      }
    }
  }
  return result;
}

watch(() => props.allRecords, () => {
  if (props.allRecords.length > 0) {
    metrics.value = detectMetrics();
    analyzed.value = false;
  }
}, { immediate: true });

// ── Pareto 判定 ──
function isDominated(a: OmRecordDTO, b: OmRecordDTO): boolean {
  if (!a.score || !b.score) return false;
  return (b.score.cost <= a.score.cost && b.score.cycles <= a.score.cycles && b.score.area <= a.score.area) &&
         (b.score.cost < a.score.cost || b.score.cycles < a.score.cycles || b.score.area < a.score.area);
}

// ── 分析结果 ──
interface OptSuggestion { key: string; label: string; userVal: number; targetVal: number; gap: number; priority: number }

const isParetoOptimal = ref<boolean | null>(null);
const dominatingRecord = ref<OmRecordDTO | null>(null);
const suggestions = ref<OptSuggestion[]>([]);

const chartContainer = ref<HTMLDivElement | null>(null);
let chartInstance: echarts.ECharts | null = null;

function percentileNorm(rawValue: number, allValues: number[]): number {
  if (allValues.length <= 1) return 0.5;
  const sorted = [...allValues].sort((a, b) => a - b);
  const rank = sorted.filter(v => v <= rawValue).length;
  return 1 - (rank - 1) / (sorted.length - 1);
}

// 构造一个虚拟 record 代表用户输入
function buildUserRecord(): OmRecordDTO | null {
  const active = metrics.value.filter(m => m.value != null);
  if (active.length === 0) return null;
  const s: any = { cost: 0, cycles: 0, area: 0, instructions: 0, overlap: false, trackless: false };
  for (const m of active) {
    if (m.key === "width") s[m.key] = m.value!;
    else s[m.key] = m.value!;
  }
  return { id: "__user__", puzzle: props.allRecords[0]?.puzzle, score: s as OmScoreDTO,
    smartFormattedScore: null, fullFormattedScore: null, categoryIds: null,
    author: null, gif: null, solution: null, lastModified: null };
}

function analyze() {
  const scored = props.allRecords.filter(r => r.score != null);
  const activeMetrics = metrics.value.filter(m => m.value != null);
  if (activeMetrics.length === 0 || scored.length === 0) return;

  const pareto = scored.filter(c => !scored.some(o => isDominated(c, o)));
  const userRec = buildUserRecord();
  if (!userRec) return;

  // Step 1: 判断用户是否被 Pareto 支配
  const dominators = pareto.filter(p => doesDominate(p, userRec));
  isParetoOptimal.value = dominators.length === 0;

  // Step 2: 找最近支配者（归一化欧几里得距离）
  let bestDominator: OmRecordDTO | null = null;
  let bestDist = Infinity;

  // 无论是否被支配，都找最近的 Pareto 记录（如果不被支配则取最近的非支配邻居）
  const userNorms = activeMetrics.map(m => {
    const vals = scored.map(r => getRaw(r.score!, m.key)).filter(v => v != null) as number[];
    return percentileNorm(m.value!, vals);
  });

  const targets = dominators.length > 0 ? dominators : pareto;
  for (const pr of targets) {
    let dist = 0;
    for (let i = 0; i < activeMetrics.length; i++) {
      const m = activeMetrics[i];
      const vals = scored.map(r => getRaw(r.score!, m.key)).filter(v => v != null) as number[];
      const pNorm = percentileNorm(getRaw(pr.score!, m.key)!, vals);
      dist += (pNorm - userNorms[i]) ** 2;
    }
    dist = Math.sqrt(dist);
    if (dist < bestDist) { bestDist = dist; bestDominator = pr; }
  }
  dominatingRecord.value = bestDominator;

  // Step 3: 优化建议 — 对标的 Pareto 记录逐维比较
  if (bestDominator) {
    const suggs: OptSuggestion[] = [];
    for (const m of activeMetrics) {
      const userVal = m.value!;
      const targetVal = getRaw(bestDominator.score!, m.key)!;
      const gap = targetVal - userVal; // 正值 = 需要降低
      suggs.push({
        key: m.key, label: m.label,
        userVal,
        targetVal,
        gap,
        priority: 0,
      });
    }
    suggs.sort((a, b) => b.gap - a.gap);
    suggs.forEach((s, i) => s.priority = i + 1);
    suggestions.value = suggs;
  }

  analyzed.value = true;
  nextTick(() => renderImproveChart(userNorms, bestDominator, activeMetrics));
}

// 严格支配：所有维度 ≤ 且至少一个 <
function doesDominate(a: OmRecordDTO, b: OmRecordDTO): boolean {
  if (!a.score || !b.score) return false;
  const keys = metrics.value.filter(m => m.value != null).map(m => m.key);
  let anyStrict = false;
  for (const k of keys) {
    const va = getRaw(a.score, k);
    const vb = getRaw(b.score, k);
    if (va == null || vb == null) continue;
    if (va > vb) return false;  // A 在某个维度更差 → 不支配
    if (va < vb) anyStrict = true;
  }
  return anyStrict;
}

// 雷达图
function renderImproveChart(userNorms: number[], targetRec: OmRecordDTO | null, activeMetrics: MetricDef[]) {
  if (!chartContainer.value) return;
  if (chartInstance && chartInstance.getDom() !== chartContainer.value) {
    chartInstance.dispose(); chartInstance = null;
  }
  if (!chartInstance) chartInstance = echarts.init(chartContainer.value);

  const indicators = activeMetrics.map(m => ({ name: m.label, max: 1 }));
  const bestVals = activeMetrics.map(() => 1);
  const scored = props.allRecords.filter(r => r.score != null);
  const targetNorms = targetRec
    ? activeMetrics.map(m => {
        const vals = scored.map(r => getRaw(r.score!, m.key)).filter(v => v != null) as number[];
        return percentileNorm(getRaw(targetRec.score!, m.key)!, vals);
      })
    : activeMetrics.map(() => 0);

  chartInstance.clear();
  chartInstance.setOption({
    tooltip: {
      trigger: "item",
      backgroundColor: "#121620",
      borderColor: "#ffb703",
      textStyle: { color: "#e2e8f0", fontFamily: "monospace", fontSize: 11 },
    },
    radar: {
      indicator: indicators,
      shape: "circle", center: ["50%", "50%"], radius: "60%",
      axisName: { color: "#4e5d78", fontSize: 10, fontFamily: "monospace" },
      splitArea: { areaStyle: { color: ["rgba(0,180,216,0.02)", "rgba(0,180,216,0.04)"] } },
      splitLine: { lineStyle: { color: "#262e3f" } },
      axisLine: { lineStyle: { color: "#262e3f" } },
    },
    series: [{
      type: "radar",
      data: [
        {
          value: userNorms, name: "You",
          areaStyle: { color: "rgba(255, 183, 3, 0.18)" },
          lineStyle: { color: "#ffb703", width: 2.5 },
          itemStyle: { color: "#ffb703" },
          symbol: "circle", symbolSize: 6,
        },
        {
          value: targetNorms, name: targetRec ? "Target Pareto" : "Nearest Pareto",
          areaStyle: { color: "rgba(0, 180, 216, 0.15)" },
          lineStyle: { color: "#00b4d8", width: 2 },
          itemStyle: { color: "#00b4d8" },
          symbol: "diamond", symbolSize: 5,
        },
        {
          value: bestVals, name: "Best",
          lineStyle: { color: "#00f5d4", type: "dotted", width: 1 },
          itemStyle: { color: "#00f5d4" },
          symbol: "none", areaStyle: { opacity: 0 },
        },
      ],
    }],
  }, { notMerge: true });
}

// ── 雷达图 ──
function renderChart(userNorm: number[], paretoNorms: { rec: OmRecordDTO; norms: number[]; dist: number }[],
                     activeMetrics: MetricDef[]) {
  if (!chartContainer.value) return;
  if (chartInstance && chartInstance.getDom() !== chartContainer.value) {
    chartInstance.dispose(); chartInstance = null;
  }
  if (!chartInstance) chartInstance = echarts.init(chartContainer.value);

  const indicators = activeMetrics.map(m => ({ name: m.label, max: 1 }));
  const bestVals = activeMetrics.map(() => 1);
  const closestNorm = paretoNorms[0]?.norms || activeMetrics.map(() => 0);

  chartInstance.clear();
  chartInstance.setOption({
    tooltip: {
      trigger: "item",
      backgroundColor: "#121620",
      borderColor: "#00b4d8",
      textStyle: { color: "#e2e8f0", fontFamily: "monospace", fontSize: 11 },
    },
    radar: {
      indicator: indicators,
      shape: "circle", center: ["50%", "50%"], radius: "60%",
      axisName: { color: "#4e5d78", fontSize: 10, fontFamily: "monospace" },
      splitArea: { areaStyle: { color: ["rgba(0,180,216,0.02)", "rgba(0,180,216,0.04)"] } },
      splitLine: { lineStyle: { color: "#262e3f" } },
      axisLine: { lineStyle: { color: "#262e3f" } },
    },
    series: [{
      type: "radar",
      data: [
        {
          value: userNorm, name: "You",
          areaStyle: { color: "rgba(255, 183, 3, 0.15)" },
          lineStyle: { color: "#ffb703", width: 2.5 },
          itemStyle: { color: "#ffb703" },
          symbol: "circle", symbolSize: 6,
        },
        {
          value: closestNorm, name: "Nearest Pareto",
          areaStyle: { color: "rgba(0, 180, 216, 0.15)" },
          lineStyle: { color: "#00b4d8", width: 2 },
          itemStyle: { color: "#00b4d8" },
          symbol: "diamond", symbolSize: 5,
        },
        {
          value: bestVals, name: "Best",
          lineStyle: { color: "#00f5d4", type: "dotted", width: 1 },
          itemStyle: { color: "#00f5d4" },
          symbol: "none", areaStyle: { opacity: 0 },
        },
      ],
    }],
  }, { notMerge: true });
}
</script>

<template>
  <div class="improve-container">
    <div class="improve-header">
      <span class="improve-title">{{ t('improve_title') }}</span>
      <span class="improve-sub">{{ t('improve_sub') }}</span>
    </div>

    <div class="legend-box">
      <span class="legend-item"><span class="legend-dot" style="color:#00f5d4">▼</span> = {{ t('improve_legend1') }}</span>
      <span class="legend-item"><span class="legend-dot" style="color:#4e5d78">▲</span> = {{ t('improve_legend2') }}</span>
      <span class="legend-item">{{ t('improve_legend3') }}</span>
      <span class="legend-item">{{ t('improve_legend4') }}</span>
    </div>

    <!-- 输入区 -->
    <div class="input-grid">
      <div v-for="m in metrics" :key="m.key" class="input-slot">
        <label class="input-label">{{ m.label }}</label>
        <input
          type="number"
          v-model.number="m.value"
          :placeholder="m.label"
          class="metric-input"
          @input="analyzed = false"
        />
      </div>
    </div>

    <button
      class="analyze-btn"
      :disabled="!metrics.some(m => m.value != null)"
      @click="analyze"
    >{{ t('improve_analyze') }}</button>

    <!-- 分析结果 -->
    <div v-if="analyzed" class="results-area">
      <!-- Pareto 判定 -->
      <div class="pareto-verdict" :class="isParetoOptimal ? 'is-pareto' : 'not-pareto'">
        <span v-if="isParetoOptimal">{{ t('improve_pareto_yes') }}</span>
        <span v-else>{{ t('improve_pareto_no') }}</span>
      </div>

      <!-- 对标记录信息 -->
      <div v-if="dominatingRecord" class="target-info">
        <span class="target-label">{{ t('improve_target') }}</span>
        <span class="target-score">
          {{ dominatingRecord.score!.cost }}g / {{ dominatingRecord.score!.cycles }}c /
          {{ dominatingRecord.score!.area }}a / {{ dominatingRecord.score!.instructions }}i
          <span v-if="dominatingRecord.score!.height != null"> / {{ dominatingRecord.score!.height }}h</span>
          <span v-if="dominatingRecord.score!.width != null"> / {{ dominatingRecord.score!.width }}w</span>
          <span v-if="dominatingRecord.score!.rate != null"> / {{ dominatingRecord.score!.rate }}r</span>
        </span>
      </div>

      <!-- 优化建议 -->
      <div class="suggestions-box">
        <div class="section-title">{{ t('improve_section') }}</div>
        <div v-for="s in suggestions" :key="s.key" class="sug-row" :class="{ 'top-prio': !isParetoOptimal && s.priority <= 2 }">
          <span class="sug-rank" v-if="!isParetoOptimal">#{{ s.priority }}</span>
          <span class="sug-label">{{ s.label }}</span>
          <span class="sug-vals">{{ s.userVal }} → {{ s.targetVal }}</span>
          <span class="sug-gap" :class="s.gap < 0 ? 'need-fix' : 'good'">
            {{ s.gap < 0 ? '▼' : '▲' }} {{ Math.abs(s.gap).toFixed(0) }}
          </span>
        </div>
      </div>

      <!-- 对比雷达图 -->
      <div class="chart-wrap">
        <div ref="chartContainer" class="chart-box"></div>
      </div>
    </div>

    <div v-else class="hint-text">{{ t('improve_hint') }}</div>
  </div>
</template>

<style scoped>
.improve-container { padding: 20px 24px; max-width: 960px; margin: 0 auto; color: #e0d8c8; font-family: 'JetBrains Mono', monospace; }

.improve-header { margin-bottom: 18px; }
.improve-title { display: block; color: #c9a84c; font-size: 0.88rem; font-weight: 700; font-family: 'Cinzel', serif; letter-spacing: 2px; margin-bottom: 4px; }
.improve-sub { color: #807860; font-size: 0.66rem; }

.legend-box {
  display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px;
  padding: 10px 14px; background: rgba(0,0,0,0.2);
  border: 1px solid rgba(255,255,255,0.06); border-radius: 8px;
  font-size: 0.64rem; color: #807860;
}
.legend-item { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.legend-dot { font-weight: 700; font-size: 0.66rem; }

.input-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
.input-slot { display: flex; flex-direction: column; gap: 3px; }
.input-label { color: #807860; font-size: 0.66rem; font-family: 'Cinzel', serif; letter-spacing: 1px; }
.metric-input {
  background: rgba(0,0,0,0.25); color: #e0d8c8;
  border: 1px solid rgba(255,255,255,0.08); padding: 8px 10px; border-radius: 6px;
  font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.metric-input:focus { border-color: #c9a84c; box-shadow: 0 0 0 2px rgba(201,168,76,0.12); }

.analyze-btn {
  width: 100%; background: rgba(201,168,76,0.12); color: #e2c96e;
  border: 1px solid rgba(201,168,76,0.3); padding: 12px; border-radius: 8px;
  font-weight: 700; font-family: 'Cinzel', serif; font-size: 0.78rem;
  letter-spacing: 2px; cursor: pointer; margin-bottom: 18px;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.analyze-btn:hover { background: rgba(201,168,76,0.2); color: #fff; border-color: #c9a84c; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(201,168,76,0.2); }
.analyze-btn:disabled { opacity: 0.25; cursor: default; transform: none; }
.hint-text { color: #807860; text-align: center; padding: 40px; font-size: 0.74rem; }

.results-area { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.pareto-verdict { padding: 12px 16px; border-radius: 8px; font-size: 0.74rem; font-weight: 600; text-align: center; grid-column: 1 / -1; font-family: 'Cinzel', serif; letter-spacing: 1px; }
.pareto-verdict.is-pareto { background: rgba(90,174,111,0.08); border: 1px solid rgba(90,174,111,0.3); color: #5aae6f; }
.pareto-verdict.not-pareto { background: rgba(212,90,74,0.08); border: 1px solid rgba(212,90,74,0.3); color: #d45a4a; }

.target-info {
  background: rgba(26,23,18,0.5); border: 1px solid rgba(201,168,76,0.2);
  border-radius: 8px; padding: 10px 14px; font-size: 0.72rem;
  grid-column: 1 / -1; display: flex; gap: 8px; align-items: center;
}
.target-label { color: #c9a84c; font-weight: 600; }
.target-score { color: #e0d8c8; }

.suggestions-box {
  background: rgba(26,23,18,0.5); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px; padding: 14px; grid-column: 1;
}
.section-title { color: #c9a84c; font-size: 0.66rem; font-weight: 600; font-family: 'Cinzel', serif; letter-spacing: 1px; margin-bottom: 8px; }
.sug-row {
  display: flex; align-items: center; gap: 8px; padding: 5px 8px;
  border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.72rem;
  border-radius: 4px; transition: background 0.15s ease;
}
.sug-row.top-prio { background: rgba(201,168,76,0.04); }
.sug-rank { color: #c9a84c; min-width: 18px; font-weight: 600; }
.sug-label { color: #e0d8c8; min-width: 60px; font-weight: 600; }
.sug-vals { color: #807860; font-size: 0.66rem; flex: 1; }
.sug-gap { font-weight: 700; }
.sug-gap.need-fix { color: #5aae6f; }
.sug-gap.good { color: #6a6058; }

.chart-wrap {
  background: rgba(26,23,18,0.5); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px; padding: 14px; grid-column: 2; grid-row: 2 / 4;
}
.chart-box { width: 100%; height: 340px; }
.no-data { color: #807860; font-size: 0.7rem; font-style: italic; }
</style>
