<script setup lang="ts">
import { ref, watch, onUnmounted, nextTick, computed } from "vue";
import * as echarts from "echarts";
import type { OmRecordDTO } from "../types/om";
import { getRaw, METRIC_LABELS } from "../utils/metrics";
import { t } from "../utils/i18n";
import { logInfo, logFail } from "../utils/logBus";
import ReplayModal from "./ReplayModal.vue";

const props = defineProps<{
  record: OmRecordDTO | null;
  allRecords: OmRecordDTO[];
}>();
const emit = defineEmits<{ close: []; panelenter: []; panelleave: [] }>();

// ── GIF/MP4 预览 ──
const gifState = ref<"loading" | "loaded" | "error">("loading");
const isVideo = computed(() => /\.(mp4|webm|mov)($|\?)/i.test(props.record?.gif || ""));
function resetGif() { gifState.value = "loading"; }
function onGifOk() { gifState.value = "loaded"; }
function onGifFail() { gifState.value = "error"; }

const chartContainer = ref<HTMLDivElement | null>(null);
let chartInstance: echarts.ECharts | null = null;

const availableMetrics = computed<string[]>(() => {
  const set = new Set<string>();
  for (const r of props.allRecords) {
    const s = r.score; if (!s) continue;
    for (const k of ["cost","cycles","area","instructions","height","width","boundingHex","rate"]) {
      if (getRaw(s, k) != null) set.add(k);
    }
  }
  return [...set];
});

function defaultAxes(): string[] {
  const avail = availableMetrics.value;
  const picks: string[] = [];
  for (const want of ["cost","cycles","area","instructions","height","width","boundingHex","rate"]) {
    if (avail.includes(want) && !picks.includes(want) && picks.length < 6) picks.push(want);
  }
  while (picks.length < 6) picks.push("cost");
  return picks.slice(0, 6);
}

const axisKeys = ref<string[]>(defaultAxes());
watch(availableMetrics, () => { axisKeys.value = defaultAxes(); });
function onAxisChange() { renderChart("axis-change"); }

// ── 百分位归一化 ──
function percentileNorm(rawValue: number, allValues: number[]): number {
  if (allValues.length <= 1) return 0.5;
  const sorted = [...allValues].sort((a, b) => a - b);
  const rank = sorted.filter(v => v <= rawValue).length;
  return 1 - (rank - 1) / (sorted.length - 1);
}

function normalizeRecord(keys: string[], rec: OmRecordDTO | null): number[] {
  if (!rec?.score) return keys.map(() => 0);
  const scored = props.allRecords.filter(r => r.score != null);
  return keys.map(k => {
    const vals = scored.map(r => getRaw(r.score!, k)).filter(v => v != null) as number[];
    const raw = getRaw(rec.score!, k);
    if (raw == null || vals.length === 0) return 0;
    return percentileNorm(raw, vals);
  });
}

// ── Sum4 中位数参考 ──
const sum4MedianRecord = computed<OmRecordDTO | null>(() => {
  const scored = props.allRecords.filter(r => r.score != null);
  if (scored.length === 0) return null;
  const withSum4 = scored.map(r => ({
    r,
    s4: r.score!.cost + r.score!.cycles + r.score!.area + r.score!.instructions,
  }));
  withSum4.sort((a, b) => a.s4 - b.s4);
  return withSum4[Math.floor(withSum4.length / 2)].r;
});

// ── tooltip 用的原始值缓存 ──
let rawThis: (number | null)[] = [];
let rawMedian: (number | null)[] = [];
let rawBest: (number | null)[] = [];

// ── 渲染 ──
function renderChart(reason: string) {
  console.debug("[RADAR] renderChart:", reason, "container:", !!chartContainer.value, "record:", !!props.record?.score, "keys:", axisKeys.value.length);

  if (!chartContainer.value || !props.record?.score) return;
  const keys = axisKeys.value;
  if (keys.length === 0) return;

  if (chartInstance && chartInstance.getDom() !== chartContainer.value) {
    console.debug("[RADAR] DOM changed, re-init");
    chartInstance.dispose();
    chartInstance = null;
  }
  if (!chartInstance) {
    chartInstance = echarts.init(chartContainer.value);
  }

  const myVals = normalizeRecord(keys, props.record);
  const medianVals = normalizeRecord(keys, sum4MedianRecord.value);
  const bestVals = keys.map(() => 1);

  // 存原始值给 tooltip
  const sThis = props.record.score!;
  const sMedian = sum4MedianRecord.value?.score ?? null;
  const scored = props.allRecords.filter(r => r.score != null);
  rawThis = keys.map(k => getRaw(sThis, k));
  rawMedian = sMedian ? keys.map(k => getRaw(sMedian, k)) : keys.map(() => null);
  rawBest = keys.map(k => {
    const vals = scored.map(r => getRaw(r.score!, k)).filter(v => v != null) as number[];
    return vals.length > 0 ? Math.min(...vals) : null;
  });

  const indicators = keys.map(k => ({ name: METRIC_LABELS[k] || k, max: 1 }));

  function fmtVal(v: number | null): string {
    if (v == null) return "—";
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }

  chartInstance.clear();
  chartInstance.setOption({
    tooltip: {
      trigger: "item",
      backgroundColor: "#121620",
      borderColor: "#00b4d8",
      textStyle: { color: "#e2e8f0", fontFamily: "monospace", fontSize: 11 },
      formatter: (params: any) => {
        // 构建表格
        const lines = [`<b style="color:#00b4d8">${params.name}</b>`, ""];
        // Header
        lines.push(keys.map(k => `<span style="color:#4e5d78">${METRIC_LABELS[k]}</span>`).join("  "));
        // This
        lines.push(`<span style="color:#00b4d8">This  </span>` + rawThis.map((v, i) => {
          const c = v === rawBest[i] ? "#00f5d4" : "#e2e8f0";
          return `<span style="color:${c}">${fmtVal(v)}</span>`;
        }).join("  "));
        // Median
        lines.push(`<span style="color:#ffb703">Median</span>` + rawMedian.map(v =>
          `<span style="color:#ffb703">${fmtVal(v)}</span>`
        ).join("  "));
        // Best
        lines.push(`<span style="color:#00f5d4">Best  </span>` + rawBest.map(v =>
          `<span style="color:#00f5d4">[${fmtVal(v)}]</span>`
        ).join("  "));
        return lines.join("<br>");
      },
    },
    radar: {
      indicator: indicators,
      shape: "circle",
      center: ["50%", "50%"],
      radius: "60%",
      axisName: { color: "#4e5d78", fontSize: 10, fontFamily: "monospace" },
      splitArea: { areaStyle: { color: ["rgba(0,180,216,0.02)", "rgba(0,180,216,0.04)"] } },
      splitLine: { lineStyle: { color: "#262e3f" } },
      axisLine: { lineStyle: { color: "#262e3f" } },
    },
    series: [{
      type: "radar",
      emphasis: { lineStyle: { width: 3 } },
      data: [
        {
          value: myVals, name: " This Record ",
          areaStyle: { color: "rgba(0, 180, 216, 0.18)" },
          lineStyle: { color: "#00b4d8", width: 2.5 },
          itemStyle: { color: "#00b4d8" },
          symbol: "circle", symbolSize: 6,
        },
        {
          value: medianVals, name: " Sum4 Median ",
          lineStyle: { color: "#ffb703", type: "dashed", width: 1.5 },
          itemStyle: { color: "#ffb703" },
          symbol: "diamond", symbolSize: 5,
          areaStyle: { opacity: 0 },
        },
        {
          value: bestVals, name: " Best ",
          lineStyle: { color: "#00f5d4", type: "dotted", width: 1 },
          itemStyle: { color: "#00f5d4" },
          symbol: "none", areaStyle: { opacity: 0 },
        },
      ],
    }],
  }, { notMerge: true });
  console.debug("[RADAR] done, width:", chartInstance.getWidth());
}

// ── 生命周期 ──
watch(() => props.record, async (rec) => {
  resetGif();
  if (rec) { await nextTick(); renderChart("record-changed"); }
});
watch([() => props.allRecords, axisKeys], () => {
  if (props.record) renderChart("records-or-axis");
});
onUnmounted(() => {
  chartInstance?.dispose();
  chartInstance = null;
});

const showReplay = ref(false);
const snapSolution = ref<string | null>(null);
const snapPuzzleId = ref("");
function openReplay() {
  const sol = props.record?.solution;
  const pid = props.record?.puzzle?.id ?? "";
  logInfo(`[Replay] Click. puzzleId="${pid}" solution=${typeof sol} len=${sol?.length ?? 0}`);
  if (!sol) { logFail("[Replay] No solution!"); return; }
  snapSolution.value = sol;
  snapPuzzleId.value = pid;
  showReplay.value = true;
}

function onKeydown(e: KeyboardEvent) { if (e.key === "Escape") emit("close"); }
watch(() => props.record, (v) => {
  if (v) document.addEventListener("keydown", onKeydown);
  else document.removeEventListener("keydown", onKeydown);
});
onUnmounted(() => document.removeEventListener("keydown", onKeydown));

function fmtDate(raw: string | null) {
  if (!raw) return "—";
  try { return new Date(raw).toLocaleString("zh-CN", { hour12: false }); }
  catch { return raw; }
}

function onPanelEnter() { emit("panelenter"); }
function onPanelLeave() { emit("panelleave"); }
</script>

<template>
  <div v-if="record" class="preview-panel" @click.self="emit('close')">
    <div class="preview-card" @mouseenter="onPanelEnter" @mouseleave="onPanelLeave">
      <div class="preview-header">
        <span class="preview-title">{{ t('preview_title') }}</span>
        <button class="preview-close" @click="emit('close')">×</button>
      </div>

      <!-- GIF / MP4 -->
      <div class="gif-section">
        <div v-if="!record.gif" class="gif-placeholder">{{ t('preview_no_gif') }}</div>
        <template v-else>
          <video v-if="isVideo" :src="record.gif" class="gif-img" autoplay loop muted playsinline @loadeddata="onGifOk" @error="onGifFail" />
          <img v-else :src="record.gif" alt="preview" class="gif-img" @load="onGifOk" @error="onGifFail" />
          <div v-if="gifState === 'loading'" class="gif-overlay"><span class="spinner"></span></div>
          <div v-if="gifState === 'error'" class="gif-overlay">{{ t('preview_failed') }}</div>
        </template>
      </div>

      <!-- Author + Date -->
      <div class="meta-bar">
        <div class="meta-row"><span class="meta-label">{{ t('preview_author') }}</span><span class="meta-value">{{ record.author || "Unknown" }}</span></div>
        <div class="meta-row"><span class="meta-label">{{ t('preview_updated') }}</span><span class="meta-value">{{ fmtDate(record.lastModified) }}</span></div>
        <button v-if="record.solution" class="replay-btn" @click="openReplay">▶ {{ t('btn_replay') }}</button>
      </div>

      <!-- 六维选择器 -->
      <div class="axis-selectors">
        <div v-for="(key, idx) in axisKeys" :key="idx" class="axis-slot">
          <span class="slot-num">{{ idx + 1 }}</span>
          <select v-model="axisKeys[idx]" @change="onAxisChange" class="axis-dropdown">
            <option v-for="m in availableMetrics" :key="m" :value="m">{{ METRIC_LABELS[m] || m }}</option>
          </select>
        </div>
      </div>

      <!-- 雷达图 -->
      <div class="chart-section">
        <div ref="chartContainer" class="chart-box"></div>
      </div>
    </div>
  </div>

  <!-- 实时演算弹窗 -->
  <ReplayModal
    :visible="showReplay"
    :puzzleId="snapPuzzleId"
    :solution="snapSolution"
    @close="showReplay = false"
  />
</template>

<style scoped>
.preview-panel { position: fixed; inset: 0; background: transparent; z-index: 200; pointer-events: none; }
.preview-card {
  position: fixed; right: 20px; top: 50%; transform: translateY(-50%);
  width: 400px; max-height: 88vh;
  background: rgba(26, 23, 18, 0.95);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(201,168,76,0.25);
  border-radius: 12px;
  padding: 20px 22px; font-family: 'JetBrains Mono', monospace;
  box-shadow: 0 16px 48px rgba(0,0,0,0.7), 0 0 30px rgba(201,168,76,0.06);
  pointer-events: all; overflow-y: auto;
  animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes slideIn {
  from { opacity: 0; transform: translateY(-48%) translateX(30px) scale(0.97); }
  to { opacity: 1; transform: translateY(-50%) translateX(0) scale(1); }
}

.preview-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.preview-title { font-family: 'Cinzel', serif; color: #c9a84c; font-size: 0.74rem; font-weight: 600; letter-spacing: 2px; }
.preview-close {
  background: none; border: 1px solid rgba(255,255,255,0.1); color: #807860;
  font-size: 1rem; cursor: pointer; padding: 2px 8px; border-radius: 6px;
  line-height: 1; transition: all 0.2s ease;
}
.preview-close:hover { color: #d45a4a; border-color: #d45a4a; background: rgba(212,90,74,0.08); }

.gif-section {
  background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px; display: flex; align-items: center; justify-content: center;
  overflow: hidden; margin-bottom: 12px; position: relative;
}
.gif-img { max-width: 100%; display: block; height: auto; border-radius: 6px; }
.gif-placeholder { color: #807860; font-size: 0.7rem; padding: 40px 20px; }
.gif-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #807860; font-size: 0.7rem; background: rgba(0,0,0,0.6); border-radius: 8px; }
.spinner { width: 24px; height: 24px; border: 2px solid rgba(255,255,255,0.08); border-top-color: #c9a84c; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.meta-bar {
  display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 12px;
  padding: 10px 12px; background: rgba(0,0,0,0.2);
  border: 1px solid rgba(255,255,255,0.06); border-radius: 8px;
}
.meta-row { display: flex; gap: 6px; font-size: 0.66rem; }
.meta-label { color: #807860; font-family: 'Cinzel', serif; letter-spacing: 1px; }
.meta-value { color: #e0d8c8; }

.replay-btn {
  background: rgba(201,168,76,0.12); color: #e2c96e; border: 1px solid rgba(201,168,76,0.3);
  padding: 5px 12px; border-radius: 6px; font-family: 'Cinzel', serif;
  font-size: 0.6rem; cursor: pointer; letter-spacing: 1px;
  min-height: 32px; transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  margin-left: auto;
}
.replay-btn:hover {
  background: rgba(201,168,76,0.2); color: #fff;
  border-color: #c9a84c; transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(201,168,76,0.2);
}

.axis-selectors { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-bottom: 10px; }
.axis-slot { display: flex; align-items: center; gap: 3px; }
.slot-num { color: #c9a84c; font-size: 0.6rem; font-weight: 700; min-width: 12px; }
.axis-dropdown {
  flex: 1; background: rgba(0,0,0,0.2); color: #e0d8c8;
  border: 1px solid rgba(255,255,255,0.08); padding: 4px 5px; border-radius: 6px;
  font-family: 'JetBrains Mono', monospace; font-size: 0.64rem; outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.axis-dropdown:focus { border-color: #c9a84c; box-shadow: 0 0 0 2px rgba(201,168,76,0.12); }

.chart-section { margin-bottom: 6px; }
.chart-box { width: 100%; height: 260px; }
</style>
