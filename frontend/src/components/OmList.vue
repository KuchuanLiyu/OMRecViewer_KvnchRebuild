<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from "vue";
import type { OmRecordDTO } from "../types/om";
import RecordPreview from "./RecordPreview.vue";
import ImprovePanel from "./ImprovePanel.vue";
import AnalysisPanel from "./AnalysisPanel.vue";
import { t } from "../utils/i18n";

const props = defineProps<{
  records: OmRecordDTO[];
}>();

const viewMode = ref<"all" | "pareto" | "improve" | "analysis">("all");
const sortExpr = ref("CG");
const sortOrder = ref<"asc" | "desc">("asc");

const METRICS: Record<string, string> = { G:"cost", C:"cycles", A:"area", I:"instructions", H:"height", W:"width", B:"bounding", R:"rate" };
const parseSortKeys = () => {
  let expr = sortExpr.value.toUpperCase();
  expr = expr.replace(/S4/g, "CGAI").replace(/S/g, "CGA");
  const chars = expr.replace(/[^GCRAIHWBX]/g, "").split("");
  const result: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "X") {
      const prev = i > 0 ? chars[i - 1] : "";
      if (prev === "C") result.push("x:ga");
      else if (prev === "G") result.push("x:ca");
      else if (prev === "A") result.push("x:gc");
      else result.push("x:ga");
    } else {
      result.push(METRICS[chars[i]] || "cycles");
    }
  }
  return result.filter(Boolean);
};

const xMode = computed(() => {
  const m = sortExpr.value.toUpperCase().match(/([GCA])X/);
  if (!m) return null;
  if (m[1] === "C") return "ga";
  if (m[1] === "G") return "ca";
  if (m[1] === "A") return "gc";
  return null;
});
const filterTrackless = ref(false);
const filterOverlap = ref(true);
const scoreView = ref<"both" | "v" | "inf">("both");

const splitScore = (raw: string | null) => {
  if (!raw) return { v: null, inf: null };
  const parts = raw.split(" ");
  if (parts.length >= 2) {
    return { v: parts[0].replace(/@V$/, ""), inf: parts.slice(1).join(" ") };
  }
  if (raw.includes("@∞")) return { v: null, inf: raw };
  return { v: raw.replace(/@V$/, ""), inf: null };
};

const isDominated = (a: OmRecordDTO, b: OmRecordDTO): boolean => {
  if (!a.score || !b.score) return false;
  return (b.score.cost <= a.score.cost && b.score.cycles <= a.score.cycles && b.score.area <= a.score.area) &&
         (b.score.cost < a.score.cost || b.score.cycles < a.score.cycles || b.score.area < a.score.area);
};

const paretoIds = computed(() => {
  const scored = props.records.filter(r => r.score !== null);
  const frontier = scored.filter(current =>
    !scored.some(other => isDominated(current, other))
  );
  return new Set(frontier.map(r => r.id));
});

const aggregatedRecords = computed(() => {
  let baseList = props.records.filter(r => r.score !== null);

  if (filterTrackless.value) {
    baseList = baseList.filter(r => r.score!.trackless);
  }
  if (filterOverlap.value) {
    baseList = baseList.filter(r => !r.score!.overlap);
  }

  if (viewMode.value === "all") {
    baseList = baseList.filter(r => r.categoryIds && r.categoryIds.length > 0);
  }

  const paretoPrints = new Set<string>();
  for (const r of props.records) {
    if (r.score && paretoIds.value.has(r.id)) {
      const s = r.score;
      paretoPrints.add(`${s.cost}-${s.cycles}-${s.area}-${s.instructions}-${s.trackless}-${s.overlap}`);
    }
  }

  const map = new Map<string, { record: OmRecordDTO; categories: string[]; hasPareto: boolean }>();

  for (const r of baseList) {
    const s = r.score!;
    const fingerprint = `${s.cost}-${s.cycles}-${s.area}-${s.instructions}-${s.trackless}-${s.overlap}`;

    let currentCats: string[] = [];
    if (r.categoryIds && r.categoryIds.length > 0) {
      const seen = new Set<string>();
      for (const id of r.categoryIds) {
        const cat = id.split("_").pop()?.toUpperCase() || "";
        if (cat.length > 0 && !seen.has(cat)) { seen.add(cat); currentCats.push(cat); }
      }
    }

    const isPareto = paretoPrints.has(fingerprint);

    if (map.has(fingerprint)) {
      const existing = map.get(fingerprint)!;
      for (const cat of currentCats) {
        if (!existing.categories.includes(cat)) {
          existing.categories.push(cat);
        }
      }
      if (isPareto) existing.hasPareto = true;
    } else {
      map.set(fingerprint, {
        record: r,
        categories: currentCats,
        hasPareto: isPareto
      });
    }
  }

  const result = Array.from(map.values()).map(item => {
    const s = item.record.score!;
    const sum = s.cost + s.cycles + s.area;
    const sum4 = sum + s.instructions;
    const ga = s.cost * s.area;
    const ca = s.cycles * s.area;
    const gc = s.cost * s.cycles;

    return {
      ...item,
      derived: { sum, sum4, ga, ca, gc },
      isPareto: item.hasPareto,
      strengths: [] as string[],
    };
  });

  const keys = parseSortKeys();
  const getVal = (r: typeof result[0], k: string) => {
    const s = r.record.score!;
    switch (k) {
      case "cost": return s.cost;
      case "cycles": return s.cycles;
      case "area": return s.area;
      case "instructions": return s.instructions;
      case "height": return s.height ?? 0;
      case "width": return Math.round(s.width ?? 0);
      case "bounding": return s.boundingHex ?? 0;
      case "rate": return Math.round(s.rate ?? 0);
      case "x:ga": return s.cost * s.area;
      case "x:ca": return s.cycles * s.area;
      case "x:gc": return s.cost * s.cycles;
      default: return 0;
    }
  };

  // ── Compute strength badges (top 25% per dimension among Pareto) ──
  const strengthDims = ["cost","cycles","area","instructions","height","width","boundingHex","rate"];
  const paretoOnly = result.filter(r => r.isPareto);
  const paretoVals: Record<string, number[]> = {};
  for (const d of strengthDims) {
    paretoVals[d] = paretoOnly.map(r => getVal(r, d)).filter(v => v > 0).sort((a,b) => a-b);
  }
  for (const r of result) {
    const strong: string[] = [];
    for (const d of strengthDims) {
      const v = getVal(r, d);
      if (v <= 0) continue;
      const arr = paretoVals[d];
      if (arr.length < 3) continue;
      const pct = arr.filter(x => x <= v).length / arr.length;
      if (pct <= 0.25) strong.push(d === "boundingHex" ? "B" : d === "instructions" ? "I" : d === "height" ? "H" : d === "width" ? "W" : d === "rate" ? "R" : d.charAt(0).toUpperCase());
    }
    (r as any).strengths = strong;
  }
  result.sort((a, b) => {
    for (const k of keys) {
      const va = getVal(a, k);
      const vb = getVal(b, k);
      if (va !== vb) return sortOrder.value === "asc" ? va - vb : vb - va;
    }
    return 0;
  });

  return result;
});

const puzzleInfo = computed(() => {
  if (props.records.length === 0) return null;
  const p = props.records[0].puzzle;
  return { id: p.id, name: p.displayName, chapter: p.group.displayName };
});

const selectedRecord = ref<OmRecordDTO | null>(null);

// ── Hover 预览 ──
const hoveredRecord = ref<OmRecordDTO | null>(null);
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let leaveTimer: ReturnType<typeof setTimeout> | null = null;

function onRowMouseEnter(rec: OmRecordDTO) {
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
  hoverTimer = setTimeout(() => {
    hoveredRecord.value = rec;
  }, 500);
}
function onRowMouseLeave() {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  leaveTimer = setTimeout(() => { hoveredRecord.value = null; }, 400);
}

// ── Copy score ──
const copiedId = ref<string | null>(null);
async function copyScore(rec: OmRecordDTO) {
  if (!rec.score) return;
  const s = rec.score;
  const text = `Cost:${s.cost} Cycles:${s.cycles} Area:${s.area} Instr:${s.instructions}` +
    (s.height != null ? ` H:${s.height}` : '') +
    (s.width != null ? ` W:${s.width}` : '') +
    (s.boundingHex != null ? ` B:${s.boundingHex}` : '') +
    (s.rate != null ? ` R:${s.rate}` : '') +
    (s.trackless ? ' T' : '') + (!s.overlap ? ' L' : '');
  try {
    await navigator.clipboard.writeText(text);
    copiedId.value = rec.id;
    setTimeout(() => { copiedId.value = null; }, 1200);
  } catch { /* ignore */ }
}
function closePreview() { hoveredRecord.value = null; }
function onPanelEnter() {
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
}
function onPanelLeave() {
  leaveTimer = setTimeout(() => { hoveredRecord.value = null; }, 400);
}

// ── 下载全部记录 ──
function downloadRecords() {
  const puzzleId = puzzleInfo.value?.id || "unknown";
  const json = JSON.stringify(props.records, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${puzzleId}_records.json`;
  a.click();
  URL.revokeObjectURL(url);
}

const onKeydown = (e: KeyboardEvent) => { if (e.key === "Escape") selectedRecord.value = null; };
watch(selectedRecord, (v) => {
  if (v) document.addEventListener("keydown", onKeydown);
  else document.removeEventListener("keydown", onKeydown);
});
onUnmounted(() => document.removeEventListener("keydown", onKeydown));

const formatDate = (raw: string | null) => {
  if (!raw) return "—";
  try {
    const d = new Date(raw);
    return d.toLocaleString("zh-CN", { hour12: false });
  } catch {
    return raw;
  }
};

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
};

const handleHeaderClick = (expr: string) => {
  if (sortExpr.value === expr) {
    sortOrder.value = sortOrder.value === "asc" ? "desc" : "asc";
  } else {
    sortExpr.value = expr;
    sortOrder.value = "asc";
  }
};
</script>

<template>
  <div class="list-wrapper">
    <div class="action-dashboard">
      <div class="dashboard-group">
        <div class="view-mode-selector">
          <button class="mode-btn" :class="{ active: viewMode === 'all' }" @click="viewMode = 'all'">{{ t('mode_record') }}</button>
          <button class="mode-btn" :class="{ active: viewMode === 'pareto' }" @click="viewMode = 'pareto'">{{ t('mode_frontier') }}</button>
          <button class="mode-btn analysis-btn" :class="{ active: viewMode === 'analysis' }" @click="viewMode = 'analysis'">{{ t('mode_analysis') }}</button>
          <button class="mode-btn improve-btn" :class="{ active: viewMode === 'improve' }" @click="viewMode = 'improve'">{{ t('mode_improve') }}</button>
        </div>
      </div>
      <div class="dashboard-group">
        <button class="mode-btn download-btn" @click="downloadRecords">{{ t('btn_download') }}</button>
      </div>
      <div class="dashboard-group score-view-group">
        <button class="mode-btn" :class="{ active: scoreView === 'both' }" @click="scoreView = 'both'">@V+∞</button>
        <button class="mode-btn" :class="{ active: scoreView === 'v' }" @click="scoreView = 'v'">@V</button>
        <button class="mode-btn" :class="{ active: scoreView === 'inf' }" @click="scoreView = 'inf'">@∞</button>
      </div>
      <div class="dashboard-group filter-group">
        <label class="filter-checkbox" :class="{ checked: filterTrackless }">
          <input type="checkbox" v-model="filterTrackless" />
          <span>T</span>
        </label>
        <label class="filter-checkbox" :class="{ checked: filterOverlap }">
          <input type="checkbox" v-model="filterOverlap" />
          <span>!O</span>
        </label>
      </div>
      <div class="dashboard-group sort-selector">
        <span class="control-text">{{ t('sort_label') }}</span>
        <input type="text" v-model="sortExpr" class="sort-input" placeholder="CGA..." title="G/C/A/I/H/W/B/R  S=Sum S4=Sum4  CX=sort by Cycles then G*A" />
        <select v-model="sortOrder">
          <option value="asc">ASC</option>
          <option value="desc">DESC</option>
        </select>
      </div>
    </div>

    <div v-if="puzzleInfo" class="puzzle-header">
      <span class="puzzle-chapter">{{ puzzleInfo.chapter }}</span>
      <span class="puzzle-sep">/</span>
      <span class="puzzle-name">{{ puzzleInfo.name }}</span>
      <span class="puzzle-id">#{{ puzzleInfo.id }}</span>
    </div>

    <Transition name="view-switch" mode="out-in">
      <ImprovePanel v-if="viewMode === 'improve'" :key="'improve'" :allRecords="props.records" />
      <AnalysisPanel v-else-if="viewMode === 'analysis'" :key="'analysis'" :allRecords="props.records" />
      <div v-else :key="'table'" class="matrix-container">
      <table class="matrix-table">
        <thead>
          <tr>
            <th style="width: 18%">{{ t('col_category') }}</th>
            <th style="width: 40%">{{ t('col_score') }}</th>
            <th @click="handleHeaderClick('S')" class="sortable">{{ t('col_sum') }}</th>
            <th @click="handleHeaderClick('S4')" class="sortable">{{ t('col_sum4') }}</th>
            <th style="width: 16%">{{ t('col_derived') }}</th>
            <th style="width: 4%"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in aggregatedRecords" :key="item.record.id || Math.random()"
              class="matrix-row" :class="{ pareto: item.isPareto, 'row-hovered': hoveredRecord === item.record }"
              @mouseenter="onRowMouseEnter(item.record)"
              @mouseleave="onRowMouseLeave()">
            <td class="category-cell">
              <span class="cat-prefix">{{ item.categories.length > 0 ? item.categories.join(", ") : "—" }}</span>
            </td>
            <td class="score-string" @click.stop="copyScore(item.record)" title="Click score to copy">
              <span v-if="item.strengths.length > 0" class="strength-inline">
                <span v-for="d in item.strengths" :key="d">{{ d }}</span>
              </span>
              <template v-if="item.record.fullFormattedScore">
                <span v-if="scoreView !== 'inf'" class="score-line">{{ splitScore(item.record.fullFormattedScore).v }}</span>
                <span v-if="scoreView !== 'v' && splitScore(item.record.fullFormattedScore).inf" class="score-line score-inf">{{ splitScore(item.record.fullFormattedScore).inf }}</span>
              </template>
              <template v-else>
                <span class="score-full">{{ item.record.score!.cost }}g/{{ item.record.score!.cycles }}c/{{ item.record.score!.area }}a/{{ item.record.score!.instructions }}i<span v-if="item.record.score!.height != null">/{{ item.record.score!.height }}h</span><span v-if="item.record.score!.width != null">/{{ item.record.score!.width }}w</span><span v-if="item.record.score!.boundingHex != null">/{{ item.record.score!.boundingHex }}b</span><span v-if="item.record.score!.trackless">/T</span><span v-if="!item.record.score!.overlap">/L</span></span>
              </template>
              <span v-if="copiedId === item.record.id" class="copied-toast">✓ Copied</span>
            </td>
            <td class="num-val">{{ item.derived.sum }}</td>
            <td class="num-val">{{ item.derived.sum4 }}</td>
            <td class="multiplier-cell">
              <span v-if="xMode === 'ga'" class="m-item">g·a={{ item.derived.ga }}</span>
              <span v-else-if="xMode === 'ca'" class="m-item">c·a={{ item.derived.ca }}</span>
              <span v-else-if="xMode === 'gc'" class="m-item">g·c={{ item.derived.gc }}</span>
              <span v-else class="m-item">g·a={{ item.derived.ga }}</span>
              <span v-if="item.record.score!.rate != null" class="m-item rate-item">r={{ item.record.score!.rate }}</span>
            </td>
            <td class="detail-cell">
              <button class="detail-btn" @click.stop="selectedRecord = item.record" title="Details">+</button>
            </td>
          </tr>
          <tr v-if="aggregatedRecords.length === 0">
            <td colspan="6" class="matrix-empty">{{ t('empty_table') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    </Transition>

    <div v-if="selectedRecord" class="detail-overlay" @click.self="selectedRecord = null">
      <div class="detail-modal">
        <div class="detail-header">
          <span class="detail-title">{{ t('preview_title') }}</span>
          <button class="detail-close" @click="selectedRecord = null">×</button>
        </div>
        <div class="detail-body">
          <div class="detail-row">
            <span class="detail-label">{{ t('preview_author') }}</span>
            <span class="detail-value">{{ selectedRecord.author || "—" }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ t('preview_updated') }}</span>
            <span class="detail-value">{{ formatDate(selectedRecord.lastModified) }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ t('preview_gif') }}</span>
            <code class="detail-link">{{ selectedRecord.gif || "—" }}</code>
            <button class="copy-btn" @click="copyToClipboard(selectedRecord.gif!)" :disabled="!selectedRecord.gif">{{ t('preview_copy') }}</button>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ t('preview_solution') }}</span>
            <code class="detail-link">{{ selectedRecord.solution || "—" }}</code>
            <button class="copy-btn" @click="copyToClipboard(selectedRecord.solution!)" :disabled="!selectedRecord.solution">{{ t('preview_copy') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Hover 预览浮层 -->
    <RecordPreview
      :record="hoveredRecord"
      :allRecords="props.records"
      @close="closePreview"
      @panelenter="onPanelEnter"
      @panelleave="onPanelLeave"
    />
  </div>
</template>

<style scoped>
/* ── Action Dashboard ── */
.action-dashboard {
  background: var(--bg-glass, rgba(26,23,18,0.85));
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--border-color, rgba(255,255,255,0.08));
  padding: 10px 16px; border-radius: var(--radius-md, 8px); margin-bottom: 14px;
  display: flex; justify-content: space-between; align-items: center;
  gap: 10px; flex-wrap: wrap;
  box-shadow: 0 1px 8px rgba(0,0,0,0.3);
}
.view-mode-selector {
  display: flex; background: rgba(0,0,0,0.2);
  padding: 3px; border-radius: var(--radius-md, 8px);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.05));
  position: relative;
}

.mode-btn {
  background: none; border: none; color: #807860; padding: 6px 14px;
  font-family: 'Cinzel', serif; font-size: 0.62rem; font-weight: 600;
  cursor: pointer; border-radius: 6px; letter-spacing: 1.5px;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative; z-index: 1;
}
.mode-btn::after {
  content: ''; position: absolute; bottom: 0; left: 25%; right: 25%; height: 2px;
  background: #c9a84c; border-radius: 1px;
  transform: scaleX(0); transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.mode-btn.active::after { transform: scaleX(1); }
.mode-btn.active {
  background: rgba(201,168,76,0.1); color: #e2c96e;
}
.mode-btn:hover:not(.active) { color: #c0b898; }
.mode-btn.improve-btn.active { background: rgba(196,122,90,0.15); color: #e8a080; }
.mode-btn.improve-btn::after { background: #c47a5a; }
.mode-btn.analysis-btn.active { background: rgba(129,140,248,0.12); color: #a5b4fc; }
.mode-btn.analysis-btn::after { background: #818cf8; }
.mode-btn.download-btn {
  color: #c9a84c; border: 1px solid rgba(201,168,76,0.25); border-radius: 6px;
  padding: 5px 12px; font-size: 0.62rem;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.mode-btn.download-btn:hover { background: rgba(201,168,76,0.12); color: #e2c96e; transform: translateY(-1px); }

.control-text { font-size: 0.68rem; color: #807860; margin-right: 4px; }
.sort-input {
  background: rgba(0,0,0,0.25); color: #e0d8c8; border: 1px solid rgba(255,255,255,0.08);
  padding: 5px 10px; border-radius: 6px; font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem; outline: none; width: 80px;
  transition: border-color 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.sort-input:focus { border-color: #c9a84c; box-shadow: 0 0 0 2px rgba(201,168,76,0.12); }
.sort-selector select {
  background: rgba(0,0,0,0.25); color: #e0d8c8; border: 1px solid rgba(255,255,255,0.08);
  padding: 5px 8px; border-radius: 6px; font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem; outline: none; cursor: pointer;
}

/* ── Table ── */
.matrix-container {
  background: var(--bg-glass, rgba(26,23,18,0.85));
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--border-color, rgba(255,255,255,0.08));
  border-radius: var(--radius-lg, 12px); overflow: hidden;
  box-shadow: 0 2px 16px rgba(0,0,0,0.3);
}
.matrix-table { width: 100%; border-collapse: collapse; font-family: 'JetBrains Mono', monospace; font-size: 0.82rem; text-align: left; }
th, td { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.04); }
th {
  background: rgba(0,0,0,0.2); color: #807860; font-size: 0.68rem; font-weight: 500;
  font-family: 'Cinzel', serif; letter-spacing: 1px;
  border-bottom: 1px solid rgba(201,168,76,0.2);
  position: sticky; top: 0; z-index: 2;
}
.sortable { cursor: pointer; user-select: none; transition: color 0.2s ease; }
.sortable:hover { color: #e0d8c8; }
.sortable.active { color: #c9a84c; font-weight: 700; }

.matrix-row {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  animation: rowIn 0.4s ease-out both;
}
.matrix-row:nth-child(1) { animation-delay: 0.02s; }
.matrix-row:nth-child(2) { animation-delay: 0.04s; }
.matrix-row:nth-child(3) { animation-delay: 0.06s; }
.matrix-row:nth-child(4) { animation-delay: 0.08s; }
.matrix-row:nth-child(5) { animation-delay: 0.10s; }
.matrix-row:nth-child(6) { animation-delay: 0.12s; }
.matrix-row:nth-child(7) { animation-delay: 0.14s; }
.matrix-row:nth-child(8) { animation-delay: 0.16s; }
@keyframes rowIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
.matrix-row:hover { background: rgba(201,168,76,0.04); }
.matrix-row.row-hovered {
  background: rgba(201,168,76,0.08) !important;
  box-shadow: inset 2px 0 0 #c9a84c;
  transform: none;
  z-index: 10; position: relative;
}

.category-cell { color: #d4c8a8; font-weight: 600; font-size: 0.74rem; }
.score-string { color: #e0d8c8; font-size: 0.76rem; line-height: 1.4; display: flex; flex-direction: column; gap: 2px; }
.score-line { word-break: break-all; }
.score-inf { color: #c9a84c; }
.score-full { word-break: break-all; }
.score-string span { color: #c47a5a; font-weight: 600; }
.num-val { color: #c9a84c; }
.num-val.sort-highlight { color: #c47a5a; font-weight: 700; background: rgba(196,122,90,0.06); }

.multiplier-cell { color: #807860; font-size: 0.72rem; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.copied-toast {
  position: absolute; top: -18px; left: 50%; transform: translateX(-50%);
  background: #5aae6f; color: #0c0a06; padding: 2px 8px; border-radius: 4px;
  font-size: 0.62rem; font-weight: 700; white-space: nowrap;
  animation: toastPop 1.2s ease-out forwards; pointer-events: none; z-index: 5;
}
@keyframes toastPop {
  0% { opacity: 0; transform: translateX(-50%) translateY(4px); }
  15% { opacity: 1; transform: translateX(-50%) translateY(0); }
  75% { opacity: 1; }
  100% { opacity: 0; transform: translateX(-50%) translateY(-8px); }
}
.score-string { position: relative; }

.strength-inline {
  color: #818cf8; font-weight: 700; font-size: 0.66rem;
  margin-right: 6px; display: inline-flex; gap: 3px;
}

/* ── View transitions ── */
.view-switch-enter-active { transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
.view-switch-leave-active { transition: all 0.2s ease-in; }
.view-switch-enter-from { opacity: 0; transform: translateY(12px); }
.view-switch-leave-to { opacity: 0; transform: translateY(-8px); }
.m-item { background: rgba(0,0,0,0.2); padding: 2px 7px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05); }

.puzzle-header {
  background: rgba(26,23,18,0.6);
  border: 1px solid rgba(255,255,255,0.06); border-bottom: none;
  border-radius: 8px 8px 0 0; padding: 10px 16px;
  font-family: 'Cinzel', serif; font-size: 0.72rem;
  display: flex; align-items: center; gap: 6px;
}
.puzzle-chapter { color: #807860; }
.puzzle-sep { color: rgba(255,255,255,0.1); }
.puzzle-name { color: #e0d8c8; font-weight: 600; }
.puzzle-id { color: #c9a84c; margin-left: 8px; font-size: 0.66rem; }

.matrix-empty { text-align: center; color: #807860; padding: 40px; font-style: italic; }

/* ── Dashboard groups ── */
.dashboard-group { display: flex; align-items: center; gap: 8px; }
.dashboard-group + .dashboard-group { border-left: 1px solid rgba(255,255,255,0.06); padding-left: 14px; }

.filter-group { gap: 4px; }
.filter-checkbox {
  display: flex; align-items: center; gap: 3px; cursor: pointer;
  font-size: 0.66rem; color: #807860; padding: 3px 10px;
  border-radius: 6px; border: 1px solid transparent; user-select: none;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.filter-checkbox input { display: none; }
.filter-checkbox span { font-weight: 600; }
.filter-checkbox.checked { color: #c9a84c; border-color: rgba(201,168,76,0.25); background: rgba(201,168,76,0.08); }
.filter-checkbox:hover { border-color: rgba(201,168,76,0.2); }

.matrix-row.pareto { background: rgba(201,168,76,0.02); }
.matrix-row.pareto:hover { background: rgba(201,168,76,0.06); }

/* ── Detail button & modal ── */
.detail-cell { text-align: center; }
.detail-btn {
  background: none; border: 1px solid rgba(255,255,255,0.1); color: #807860;
  font-size: 0.85rem; cursor: pointer; padding: 2px 8px; border-radius: 6px;
  font-family: 'JetBrains Mono', monospace; line-height: 1;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.detail-btn:hover { color: #c9a84c; border-color: #c9a84c; background: rgba(201,168,76,0.08); transform: scale(1.1); }

.detail-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.7);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 100;
  display: flex; align-items: center; justify-content: center;
  animation: fadeIn 0.2s ease-out;
}
.detail-modal {
  width: 520px; max-height: 80vh; font-size: 0.78rem;
  background: var(--bg-glass, rgba(26,23,18,0.95));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(201,168,76,0.25);
  border-radius: var(--radius-lg, 12px); padding: 24px; overflow-y: auto;
  font-family: 'JetBrains Mono', monospace;
  box-shadow: 0 16px 48px rgba(0,0,0,0.7), 0 0 30px rgba(201,168,76,0.06);
  animation: scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.detail-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.detail-title {
  font-family: 'Cinzel', serif; color: #c9a84c; font-size: 0.78rem;
  font-weight: 600; letter-spacing: 2px;
}
.detail-close {
  background: none; border: 1px solid rgba(255,255,255,0.1); color: #807860;
  font-size: 1.1rem; cursor: pointer; padding: 2px 8px; border-radius: 6px;
  transition: all 0.2s ease;
}
.detail-close:hover { color: #d45a4a; border-color: #d45a4a; background: rgba(212,90,74,0.08); }
.detail-body { display: flex; flex-direction: column; gap: 12px; }
.detail-row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 6px; }
.detail-label { color: #807860; font-size: 0.68rem; min-width: 70px; font-family: 'Cinzel', serif; letter-spacing: 1px; }
.detail-value { color: #e0d8c8; font-size: 0.78rem; }
.detail-link { color: #e0d8c8; font-size: 0.72rem; word-break: break-all; flex: 1; min-width: 0; background: rgba(0,0,0,0.2); padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06); }
.copy-btn {
  background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.08); color: #807860;
  font-size: 0.66rem; padding: 3px 10px; border-radius: 6px; cursor: pointer;
  font-family: 'JetBrains Mono', monospace; white-space: nowrap;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.copy-btn:hover { color: #c9a84c; border-color: #c9a84c; background: rgba(201,168,76,0.08); }
.copy-btn:disabled { opacity: 0.3; cursor: default; }
.copy-btn:disabled:hover { color: #807860; border-color: rgba(255,255,255,0.08); background: rgba(0,0,0,0.2); }
.muted { color: #807860; font-style: italic; }

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes scaleIn { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
</style>
