<script setup lang="ts">
import { ref, computed } from "vue";
import { OmRecordDTO } from "../types/om";
import DraftJudgePanel from "./DraftJudgePanel.vue";
import NavigatorPanel from "./NavigatorPanel.vue";
import RecordDetail from "./RecordDetail.vue";

const props = defineProps<{
  records: OmRecordDTO[];
}>();

const viewMode = ref<"all" | "pareto" | "judge" | "navigator">("all");
const sortExpr = ref(localStorage.getItem("om_sort_expr") || "CG");
const sortOrder = ref<"asc" | "desc">((localStorage.getItem("om_sort_order") as "asc" | "desc") || "asc");

const METRICS: Record<string, string> = { G:"cost", C:"cycles", A:"area", I:"instructions", H:"height", W:"width", B:"boundingHex", R:"rate", S:"sum", M:"sum4" };

// ── 完整指标注册表：所有可显示指标的定义 ──
interface MetricDef {
  key: string;
  short: string;
  label: string;
  nullable: boolean;
}
const ALL_METRICS: MetricDef[] = [
  { key: "cost",    short: "G",  label: "Cost",   nullable: false },
  { key: "cycles",  short: "C",  label: "Cycles", nullable: false },
  { key: "area",    short: "A",  label: "Area",   nullable: false },
  { key: "instructions", short: "I",  label: "Instr",  nullable: false },
  { key: "height",  short: "H",  label: "Height", nullable: true },
  { key: "width",   short: "W",  label: "Width",  nullable: true },
  { key: "boundingHex", short: "B", label: "Bound", nullable: true },
  { key: "rate",    short: "R",  label: "Rate",   nullable: true },
];

// ── 从 score 中安全取值 ──
const getMetricVal = (s: Record<string, any>, key: string): number | null => {
  const v = s[key];
  return (v === null || v === undefined) ? null : (Number(v) as number);
};

// ── 用户可见指标配置（默认全部开启，有数据的指标自动生效）──
const BEST_KEY = "om_best_metrics";
const visibleMetrics = ref<Set<string>>(new Set(
  JSON.parse(localStorage.getItem(BEST_KEY) || JSON.stringify(ALL_METRICS.map(m => m.key)))
));
const showMetricSettings = ref(false);

const toggleMetric = (key: string) => {
  const next = new Set(visibleMetrics.value);
  if (next.has(key)) {
    if (next.size > 1) next.delete(key);
  } else {
    next.add(key);
  }
  visibleMetrics.value = next;
  localStorage.setItem(BEST_KEY, JSON.stringify([...next]));
};
const parseSortKeys = () => {
  let expr = sortExpr.value.toUpperCase();
  expr = expr.replace(/SUM4|S4/g, "M").replace(/SUM/g, "S");
  const chars = expr.replace(/[^GCRMAIHWBSX]/g, "").split("");
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

// 检测 sortExpr 中的 X 前缀，决定 DERIVED 列显示哪个乘法
const xMode = computed(() => {
  const m = sortExpr.value.toUpperCase().match(/([GCA])X/);
  if (!m) return null;
  if (m[1] === "C") return "ga";
  if (m[1] === "G") return "ca";
  if (m[1] === "A") return "gc";
  return null;
});
const filterTrackless = ref(false);
const showOverlapOnly = ref(false); // 默认不按=只显示非O; 按下=只显示O
const scoreView = ref<"both" | "v" | "inf">("both");

// ── 当前视图下的基准最优值 ──
// 对每个指标独立计算历史最小值；仅当数据集中至少有一条记录在该指标上有非空值时才纳入
const benchmarks = computed(() => {
  const scored = props.records.filter(r => r.score !== null);
  let pool = showOverlapOnly.value ? scored.filter(r => r.score!.overlap) : scored.filter(r => !r.score!.overlap);
  if (filterTrackless.value) {
    pool = pool.filter(r => r.score!.trackless);
  }
  if (pool.length === 0) return null;
  const result: Record<string, number> = {};
  for (const m of ALL_METRICS) {
    const vals = pool.map(r => getMetricVal(r.score!, m.key)).filter(v => v !== null) as number[];
    if (vals.length > 0) {
      result[m.key] = Math.min(...vals);
    }
  }
  return result;
});

// ── 当前可见指标列表（用户勾选的 + 数据集中确实有值的）──
const activeMetrics = computed(() => {
  if (!benchmarks.value) return [];
  return ALL_METRICS.filter(m => visibleMetrics.value.has(m.key) && benchmarks.value![m.key] !== undefined);
});

// ── 计算单指标劣化百分比 ──
const pctStr = (val: number, bench: number) => {
  if (bench === 0) return "";
  const p = (val / bench) * 100;
  return p === 100 ? "" : ` (${p.toFixed(0)}%)`;
};

// 解析 fullFormattedScore 为 @V / @∞ 两部分（按空格切分）
const splitScore = (raw: string | null) => {
  if (!raw) return { v: null, inf: null };
  const parts = raw.split(" ");
  if (parts.length >= 2) {
    return { v: parts[0].replace(/@V$/, ""), inf: parts.slice(1).join(" ") };
  }
  if (raw.includes("@∞")) return { v: null, inf: raw };
  return { v: raw.replace(/@V$/, ""), inf: null };
};

const highlightScore = (raw: string, short: string): string => {
  if (!short) return raw;
  const lower = short.toLowerCase();
  return raw.split("/").map(p => {
    const m = p.match(/^(-?\d+(\.\d+)?)([a-z']+)/i);
    if (m && m[3].toLowerCase().startsWith(lower)) return `<span class="sort-primary">${p}</span>`;
    return p;
  }).join("/");
};

// ── 聚合：T/L 过滤 → ViewMode → 指纹去重 → 排序 ──
const aggregatedRecords = computed(() => {
  let baseList = props.records.filter(r => r.score !== null);

  if (filterTrackless.value) {
    baseList = baseList.filter(r => r.score!.trackless);
  }
  if (showOverlapOnly.value) {
    baseList = baseList.filter(r => r.score!.overlap);
  } else {
    baseList = baseList.filter(r => !r.score!.overlap);
  }

  if (viewMode.value === "all") {
    baseList = baseList.filter(r => r.categoryIds && r.categoryIds.length > 0);
  }

  const map = new Map<string, { record: OmRecordDTO; categories: string[] }>();

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

    if (map.has(fingerprint)) {
      const existing = map.get(fingerprint)!;
      for (const cat of currentCats) {
        if (!existing.categories.includes(cat)) {
          existing.categories.push(cat);
        }
      }
    } else {
      map.set(fingerprint, {
        record: r,
        categories: currentCats,
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
      case "width": return s.width ?? 0;
      case "boundingHex": return s.boundingHex ?? 0;
      case "rate": return s.rate ?? 0;
      case "sum": return r.derived.sum;
      case "sum4": return r.derived.sum4;
      case "x:ga": return s.cost * s.area;
      case "x:ca": return s.cycles * s.area;
      case "x:gc": return s.cost * s.cycles;
      default: return 0;
    }
  };
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
  const p = props.records.find(r => r.puzzle !== null)?.puzzle;
  if (!p) return null;
  return { id: p.id, name: p.displayName, chapter: p.group.displayName };
});

const primarySortShort = computed(() => {
  const key = parseSortKeys()[0];
  const map: Record<string,string> = { cost:"G", cycles:"C", area:"A", instructions:"I", height:"H", width:"W", boundingHex:"B", rate:"R", sum:"S", sum4:"S4" };
  return map[key] || "";
});

const selectedRecord = ref<OmRecordDTO | null>(null);

const handleHeaderClick = (expr: string) => {
  if (sortExpr.value === expr) {
    sortOrder.value = sortOrder.value === "asc" ? "desc" : "asc";
  } else {
    sortExpr.value = expr;
    sortOrder.value = "asc";
  }
  localStorage.setItem("om_sort_expr", sortExpr.value);
  localStorage.setItem("om_sort_order", sortOrder.value);
};
</script>

<template>
  <div class="list-wrapper">
    <div class="action-dashboard">
      <div class="dashboard-group">
        <div class="view-mode-selector">
          <button class="mode-btn" :class="{ active: viewMode === 'all' }" @click="viewMode = 'all'">RECORD</button>
          <button class="mode-btn" :class="{ active: viewMode === 'pareto' }" @click="viewMode = 'pareto'">FRONTIER</button>
          <button class="mode-btn mode-judge" :class="{ active: viewMode === 'judge' }" @click="viewMode = 'judge'">PARETO JUDGE</button>
          <button class="mode-btn mode-nav" :class="{ active: viewMode === 'navigator' }" @click="viewMode = 'navigator'">NAVIGATOR</button>
        </div>
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
        <label class="filter-checkbox" :class="{ checked: showOverlapOnly }">
          <input type="checkbox" v-model="showOverlapOnly" />
          <span>O</span>
        </label>
      </div>
      <div class="dashboard-group sort-selector">
        <span class="control-text">SORT:</span>
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

    <!-- 基准最优值条 + 指标设置 -->
    <div v-if="benchmarks" class="benchmark-bar">
      <span class="bench-label">BEST</span>
      <span v-for="m in activeMetrics" :key="m.key" class="bench-val">{{ m.short }}:{{ benchmarks[m.key] }}</span>
      <button class="bench-settings-btn" @click="showMetricSettings = !showMetricSettings" :class="{ active: showMetricSettings }">⚙</button>
    </div>
    <!-- 指标勾选面板 -->
    <div v-if="showMetricSettings && benchmarks" class="metric-settings">
      <label v-for="m in ALL_METRICS" :key="m.key" class="metric-check" :class="{ checked: visibleMetrics.has(m.key), disabled: benchmarks?.[m.key] === undefined }" :title="benchmarks?.[m.key] === undefined ? '数据集中无此指标' : ''">
        <input type="checkbox" :checked="visibleMetrics.has(m.key)" @change="toggleMetric(m.key)" :disabled="benchmarks?.[m.key] === undefined" />
        <span>{{ m.short }}:{{ m.label }}</span>
      </label>
    </div>

    <div class="matrix-container">
      <!-- PARETO JUDGE 视图 -->
      <div v-show="viewMode === 'judge'" class="judge-view-wrapper">
        <DraftJudgePanel :puzzle-id="puzzleInfo?.id || ''" :puzzle-name="puzzleInfo?.name || ''" />
      </div>
      <!-- NAVIGATOR 视图 -->
      <div v-show="viewMode === 'navigator'" class="judge-view-wrapper">
        <NavigatorPanel :puzzle-id="puzzleInfo?.id || ''" :records="records" :filterTrackless="filterTrackless" :filterOverlap="showOverlapOnly" :puzzle-name="puzzleInfo?.name || ''" />
      </div>
      <!-- 详情面板（替代表格） -->
      <RecordDetail v-if="selectedRecord" :record="selectedRecord" @close="selectedRecord = null" />
      <!-- 记录表格视图 -->
      <table v-show="!selectedRecord && viewMode !== 'judge' && viewMode !== 'navigator'" class="matrix-table">
        <thead>
          <tr>
            <th>CATEGORY</th>
            <th>SCORE (@V / @∞)</th>
            <th @click="handleHeaderClick('S')" class="sortable num-hdr">Sum</th>
            <th @click="handleHeaderClick('S4')" class="sortable num-hdr">Sum4</th>
            <th class="num-hdr">Derived</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in aggregatedRecords" :key="item.record.id || Math.random()" class="matrix-row">
            <td class="category-cell">
              <span class="cat-prefix">{{ item.categories.length > 0 ? item.categories.join(", ") : "—" }}</span>
            </td>
            <td class="score-string">
              <template v-if="item.record.fullFormattedScore">
                <span v-if="scoreView !== 'inf'" class="score-line" v-html="highlightScore(splitScore(item.record.fullFormattedScore).v || '', primarySortShort)"></span>
                <span v-if="scoreView !== 'v' && splitScore(item.record.fullFormattedScore).inf" class="score-line score-inf" v-html="highlightScore(splitScore(item.record.fullFormattedScore).inf || '', primarySortShort)"></span>
              </template>
              <template v-else>
                <span class="score-full">
                  <template v-for="(m, idx) in activeMetrics" :key="m.key">
                    <span v-if="idx > 0">/</span>
                    <span :class="{ 'sort-primary': m.short === primarySortShort }">{{ getMetricVal(item.record.score!, m.key) }}{{ m.short.toLowerCase() }}</span>
                    <span v-if="benchmarks && benchmarks[m.key] !== undefined">{{ pctStr(getMetricVal(item.record.score!, m.key) ?? 0, benchmarks[m.key]) }}</span>
                  </template>
                  <span v-if="item.record.score!.trackless">/T</span>
                  <span v-if="!item.record.score!.overlap">/L</span>
                </span>
              </template>
            </td>
            <td class="num-val">{{ item.derived.sum }}</td>
            <td class="num-val">{{ item.derived.sum4 }}</td>
            <td class="multiplier-cell">
              <span v-if="xMode === 'ga'" class="m-item">g·a={{ item.derived.ga }}</span>
              <span v-else-if="xMode === 'ca'" class="m-item">c·a={{ item.derived.ca }}</span>
              <span v-else-if="xMode === 'gc'" class="m-item">g·c={{ item.derived.gc }}</span>
              <span v-else class="m-item">g·a={{ item.derived.ga }}</span>
            </td>
            <td class="detail-cell">
              <button class="detail-btn" @click.stop="selectedRecord = item.record" title="Details">+</button>
            </td>
          </tr>
          <tr v-if="aggregatedRecords.length === 0">
            <td colspan="6" class="matrix-empty">NO INTEGRATED RECORDS RETURNED.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.action-dashboard { background-color: var(--bg-panel); border: 1px solid var(--border-color); padding: 8px 14px; border-radius: 4px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
.view-mode-selector { display: flex; background-color: var(--bg-deep); padding: 2px; border-radius: 4px; border: 1px solid var(--border-color); }
.mode-btn { background: none; border: none; color: var(--color-text-muted); padding: 5px 12px; font-family: monospace; font-size: 0.78rem; font-weight: bold; cursor: pointer; border-radius: 3px; }
.mode-btn.active { background-color: var(--color-primary); color: #000; }
.mode-judge.active { background-color: var(--color-primary); color: var(--bg-deep); }
.mode-judge { color: var(--color-text-muted); }
.mode-nav { color: var(--color-text-muted); }
.mode-nav.active { background-color: var(--color-primary); color: var(--bg-deep); }
.judge-view-wrapper { padding: 8px; }
.control-text { font-family: monospace; font-size: 0.75rem; color: var(--color-text-muted); margin-right: 4px; }
.sort-input { background-color: var(--bg-deep); color: var(--color-text); border: 1px solid var(--border-color); padding: 4px 8px; border-radius: 4px; font-family: monospace; font-size: 0.75rem; outline: none; width: 80px; }
.sort-input:focus { border-color: var(--color-primary); }
.sort-selector select { background-color: var(--bg-deep); color: var(--color-text); border: 1px solid var(--border-color); padding: 4px 8px; border-radius: 4px; font-family: monospace; font-size: 0.75rem; outline: none; }
.matrix-container { background-color: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 4px; overflow: hidden; min-width: 0; }
.matrix-table { width: 100%; border-collapse: collapse; font-family: Consolas, Monaco, monospace; font-size: 0.88rem; text-align: left; }
th, td { padding: 10px 12px; border-bottom: 1px solid var(--bg-input); overflow-wrap: break-word; }
th { background-color: var(--bg-panel); color: var(--color-text-muted); font-size: 0.72rem; font-weight: normal; border-bottom: 2px solid var(--border-color); font-family: 'Crimson Text', serif; letter-spacing: 0.5px; }
.sortable { cursor: pointer; user-select: none; } .sortable:hover { background-color: var(--bg-input); color: #fff; } .sortable.active { color: var(--color-warn); font-weight: bold; }
.num-hdr { text-align: right; }
.matrix-row:hover { background-color: var(--bg-input); } .category-cell { color: var(--color-accent); font-weight: bold; font-size: 0.82rem; }
.score-string { color: var(--color-text); letter-spacing: 0.3px; font-size: 0.82rem; line-height: 1.4; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.score-line { word-break: break-all; overflow-wrap: anywhere; }
.score-inf { color: var(--color-primary); }
.score-full { word-break: break-all; overflow-wrap: anywhere; }
.score-full span { color: var(--color-text); font-weight: normal; }
:deep(.sort-primary) { color: var(--color-warn); font-weight: bold; text-decoration: underline; }
.score-string span { font-weight: bold; }
.num-val { color: var(--color-primary); text-align: right; } .num-val.sort-highlight { color: var(--color-warn); font-weight: bold; background-color: rgba(255, 183, 3, 0.03); }
.multiplier-cell { color: var(--color-text-muted); font-size: 0.8rem; text-align: right; } .m-item { background-color: var(--bg-deep); padding: 2px 6px; border-radius: 2px; border: 1px solid var(--bg-input); display: inline-block; }
.puzzle-header { background-color: var(--bg-panel); border: 1px solid var(--border-color); border-bottom: none; border-radius: 4px 4px 0 0; padding: 10px 16px; font-size: 0.82rem; display: flex; align-items: center; gap: 6px; font-family: 'Crimson Text', serif; }
.puzzle-chapter { color: var(--color-text-muted); }
.puzzle-sep { color: var(--border-color); }
.puzzle-name { color: var(--color-text); font-weight: bold; }
.puzzle-id { color: var(--color-primary); margin-left: 8px; font-size: 0.72rem; }
.benchmark-bar { background: var(--bg-deep); border: 1px solid var(--bg-input); border-radius: 3px; padding: 6px 12px; margin-bottom: 8px; display: flex; align-items: center; gap: 14px; font-size: 0.75rem; }
.bench-label { color: var(--color-warn); font-weight: bold; }
.bench-val { color: var(--color-accent); font-family: monospace; }
.bench-settings-btn { background: none; border: 1px solid var(--border-color); color: var(--color-text-muted); cursor: pointer; font-size: 0.75rem; padding: 0 6px; border-radius: 3px; margin-left: auto; }
.bench-settings-btn:hover { color: var(--color-warn); border-color: var(--color-warn); }
.bench-settings-btn.active { color: var(--color-warn); border-color: var(--color-warn); background: rgba(255,183,3,0.06); }
.metric-settings { background: var(--bg-deep); border: 1px solid var(--bg-input); border-radius: 3px; padding: 6px 12px; margin-bottom: 8px; display: flex; flex-wrap: wrap; gap: 10px; }
.metric-check { display: flex; align-items: center; gap: 3px; cursor: pointer; font-family: monospace; font-size: 0.7rem; color: var(--color-text-muted); }
.metric-check input { display: none; }
.metric-check.checked { color: var(--color-accent); }
.metric-check.disabled { opacity: 0.25; cursor: not-allowed; }


.matrix-empty { text-align: center; color: var(--color-text-muted); padding: 40px; font-style: italic; }

/* ── Dashboard 分区 ── */
.dashboard-group { display: flex; align-items: center; gap: 8px; }
.dashboard-group + .dashboard-group { border-left: 1px solid var(--border-color); padding-left: 12px; }

/* ── T/L 过滤器 ── */
.filter-group { gap: 4px; }
.filter-checkbox { display: flex; align-items: center; gap: 3px; cursor: pointer; font-family: monospace; font-size: 0.72rem; color: var(--color-text-muted); padding: 2px 8px; border-radius: 3px; border: 1px solid transparent; user-select: none; }
.filter-checkbox input { display: none; }
.filter-checkbox span { font-weight: bold; }
.filter-checkbox.checked { color: var(--color-warn); border-color: var(--color-warn); background: rgba(255, 183, 3, 0.06); }
.filter-checkbox:hover { border-color: var(--color-text-muted); }

/* ── Pareto 前沿标记 ── */


/* ── 详情按钮 ── */
.detail-cell { text-align: center; }
.detail-btn { background: none; border: 1px solid var(--border-color); color: var(--color-text-muted); font-size: 0.9rem; cursor: pointer; padding: 0 6px; border-radius: 3px; font-family: monospace; line-height: 1; }
.detail-btn:hover { color: var(--color-primary); border-color: var(--color-primary); }
</style>
