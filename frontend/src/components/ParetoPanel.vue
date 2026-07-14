<script setup lang="ts">
import { ref, computed, watch } from "vue";
import * as echarts from "echarts";
import type { OmRecordDTO } from "../types/om";
import { getRaw, METRIC_LABELS } from "../utils/metrics";
import { t } from "../utils/i18n";

const props = defineProps<{ allRecords: OmRecordDTO[] }>();

function isDominated(a: OmRecordDTO, b: OmRecordDTO): boolean {
  if (!a.score || !b.score) return false;
  return (b.score.cost <= a.score.cost && b.score.cycles <= a.score.cycles && b.score.area <= a.score.area) &&
         (b.score.cost < a.score.cost || b.score.cycles < a.score.cycles || b.score.area < a.score.area);
}


// ── 类型 ──
interface OptTip { key: string; label: string; current: number; target: number; gap: number }
interface UpgradePath { sig: string; label: string; dims: string[]; targetVals: Record<string, number> }
interface ParetoEntry {
  record: OmRecordDTO;
  optimizations: OptTip[];
  signature: string;
  upgrades: UpgradePath[];
}

const groups = ref<{ signature: string; entries: ParetoEntry[]; expanded: boolean }[]>([]);
const selected = ref<ParetoEntry | null>(null);

// ── Compare 模式 ──
const compareMode = ref(false);
const compareList = ref<ParetoEntry[]>([]);
function toggleCompare() { compareMode.value = !compareMode.value; compareList.value = []; selected.value = null; }
function toggleCompareEntry(e: ParetoEntry) {
  const idx = compareList.value.indexOf(e);
  if (idx >= 0) { compareList.value.splice(idx, 1); }
  else if (compareList.value.length < 2) { compareList.value.push(e); }
  console.debug("[COMPARE] list:", compareList.value.length, compareList.value.map(x => x.record.score?.cost));
}
const compareChart2 = ref<HTMLDivElement | null>(null);
let chartInst2: echarts.ECharts | null = null;

function renderCompareChart2() {
  if (!compareChart2.value || compareList.value.length < 2) return;
  if (chartInst2 && chartInst2.getDom() !== compareChart2.value) { chartInst2.dispose(); chartInst2 = null; }
  if (!chartInst2) chartInst2 = echarts.init(compareChart2.value);

  const avail = Object.keys(METRIC_LABELS).filter(k =>
    compareList.value.some(e => getRaw(e.record.score!, k) != null)
  );
  const scored = props.allRecords.filter(r => r.score != null);
  const mins: Record<string, number> = {}, maxs: Record<string, number> = {};
  for (const k of avail) {
    const vals = scored.map(r => getRaw(r.score!, k)).filter(v => v != null) as number[];
    mins[k] = Math.min(...vals); maxs[k] = Math.max(...vals);
  }
  function toN(vals: Record<string, number>) {
    return avail.map(k => { const mn=mins[k]??0, mx=maxs[k]??1; return mx===mn?0.5:1-(vals[k]-mn)/(mx-mn); });
  }
  const colors = ["#ffb703","#00b4d8","#00f5d4"];
  chartInst2.clear();
  chartInst2.setOption({
    tooltip: { trigger:"item", backgroundColor:"#121620", borderColor:"#ffb703", textStyle:{color:"#e2e8f0",fontFamily:"monospace",fontSize:11} },
    radar: {
      indicator: avail.map(k=>({name:METRIC_LABELS[k]||k,max:1})),
      shape:"circle",center:["50%","50%"],radius:"60%",
      axisName:{color:"#4e5d78",fontSize:10,fontFamily:"monospace"},
      splitArea:{areaStyle:{color:["rgba(0,180,216,0.02)","rgba(0,180,216,0.04)"]}},
      splitLine:{lineStyle:{color:"#262e3f"}},axisLine:{lineStyle:{color:"#262e3f"}},
    },
    series:[{type:"radar",data:compareList.value.map((e,i)=>({
      value:toN(Object.fromEntries(avail.map(k=>[k,getRaw(e.record.score!,k)??0]))),
      name:e.record.score!.cost+"g/"+e.record.score!.cycles+"c/"+e.record.score!.area+"a/"+e.record.score!.instructions+"i",
      areaStyle:{color:i===0?"rgba(255,183,3,0.15)":"rgba(0,180,216,0.15)"},
      lineStyle:{color:colors[i],width:2.5},itemStyle:{color:colors[i]},
      symbol:"circle",symbolSize:6,
    }))}],
  },{notMerge:true});
}

function runAnalysis() {
  const scored = props.allRecords.filter(r => r.score != null);
  if (scored.length === 0) return;

  const avail: string[] = [];
  for (const k of ["cost","cycles","area","instructions","height","width","boundingHex","rate"]) {
    if (scored.some(r => getRaw(r.score!, k) != null)) avail.push(k);
  }
  if (avail.length < 3) return;

  const pareto = scored.filter(c => !scored.some(o => isDominated(c, o)));

  // 各维度最佳 / 最差（用于相对排名）
  const bestInDim: Record<string, number> = {};
  const maxInDim: Record<string, number> = {};
  for (const k of avail) {
    const vals = scored.map(r => getRaw(r.score!, k)).filter(v => v != null) as number[];
    bestInDim[k] = Math.min(...vals);
    maxInDim[k] = Math.max(...vals);
  }

  // 所有 Pareto 的签名集合
  const allSigs = new Set<string>();

  const entries: ParetoEntry[] = pareto.map(rec => {
    const tips: OptTip[] = [];
    for (const k of avail) {
      const cur = getRaw(rec.score!, k);
      const best = bestInDim[k];
      if (cur == null || cur <= best) continue;
      tips.push({ key: k, label: METRIC_LABELS[k] || k, current: cur, target: best, gap: cur - best });
    }
    tips.sort((a, b) => b.gap - a.gap);

    // 签名 = 相对最接近全局最优的前 2 个维度
    const ranked = avail.map(k => {
      const cur = getRaw(rec.score!, k);
      const best = bestInDim[k];
      const maxv = maxInDim[k];
      if (cur == null || maxv === best) return { key: k, score: 0 };
      return { key: k, score: 1 - (cur - best) / (maxv - best) };
    });
    ranked.sort((a, b) => b.score - a.score);
    const top2 = ranked.filter(r => r.score > 0.6).slice(0, 2).map(r => r.key);
    const sig = top2.length > 0 ? top2.map(k => METRIC_LABELS[k] || k).join("") : "Balanced";
    allSigs.add(sig);

    return { record: rec, optimizations: tips, signature: sig, upgrades: [] };
  });

  // upgrade path：每个可优化维度作为一个独立列
  for (const e of entries) {
    e.upgrades = e.optimizations.map(t => ({
      sig: t.label, label: t.label, dims: [t.key], targetVals: { [t.key]: t.target }
    }));
  }

  const map = new Map<string, ParetoEntry[]>();
  for (const e of entries) {
    if (!map.has(e.signature)) map.set(e.signature, []);
    map.get(e.signature)!.push(e);
  }

  groups.value = [...map.entries()]
    .sort((a, b) => b[0].split("+").length - a[0].split("+").length)
    .map(([sig, ents]) => ({ signature: sig, entries: ents, expanded: false }));
}

watch(() => props.allRecords, runAnalysis, { immediate: true });

function toggleGroup(g: typeof groups.value[0]) { g.expanded = !g.expanded; }

function selectEntry(e: ParetoEntry) {
  selected.value = selected.value === e ? null : e;
}

function fmtNum(v: number): string { return Number.isInteger(v) ? String(v) : v.toFixed(1); }
</script>

<template>
  <div class="pareto-container">
    <div class="pareto-header">
      <span class="pareto-title">{{ t('pareto_title') }}</span>
      <span class="pareto-sub">{{ groups.reduce((s, g) => s + g.entries.length, 0) }} {{ t('pareto_sub') }}</span>
      <button class="compare-toggle" :class="{ active: compareMode }" @click="toggleCompare">
        {{ compareMode ? t('pareto_exit_compare') : t('pareto_compare') }}
      </button>
    </div>

    <div v-if="compareList.length === 2" class="compare-floating">
      <div class="compare-floating-header">
        <span>{{ t('pareto_comparing') }}</span>
        <button @click="compareList = []">×</button>
      </div>
      <table class="compare-floating-table">
        <thead><tr><th></th><th class="c-a">{{ compareList[0].record.score!.cost }}g/{{ compareList[0].record.score!.cycles }}c/{{ compareList[0].record.score!.area }}a/{{ compareList[0].record.score!.instructions }}i</th><th class="c-b">{{ compareList[1].record.score!.cost }}g/{{ compareList[1].record.score!.cycles }}c/{{ compareList[1].record.score!.area }}a/{{ compareList[1].record.score!.instructions }}i</th><th>Δ</th></tr></thead>
        <tbody>
          <tr v-for="k in Object.keys(METRIC_LABELS).filter(k => getRaw(compareList[0].record.score!, k) != null)" :key="k">
            <td class="dim-name">{{ METRIC_LABELS[k] }}</td>
            <td class="c-a">{{ fmtNum(getRaw(compareList[0].record.score!, k)!) }}</td>
            <td class="c-b">{{ fmtNum(getRaw(compareList[1].record.score!, k)!) }}</td>
            <td :class="(getRaw(compareList[1].record.score!, k)! - getRaw(compareList[0].record.score!, k)!) < 0 ? 'delta-good' : 'delta-bad'">
              {{ (getRaw(compareList[1].record.score!, k)! - getRaw(compareList[0].record.score!, k)!) > 0 ? '+' : '' }}{{ fmtNum(getRaw(compareList[1].record.score!, k)! - getRaw(compareList[0].record.score!, k)!) }}
            </td>
          </tr>
        </tbody>
      </table>
      <div ref="compareChart2" class="compare-chart2"></div>
    </div>

    <div v-if="groups.length === 0" class="hint">No data — search a puzzle first. Groups show the #1 dimension each record can improve.</div>

    <!-- 分组 -->
    <div v-for="g in groups" :key="g.signature" class="group-card">
      <div class="group-header" @click="toggleGroup(g)">
        <span class="group-arrow">{{ g.expanded ? '▼' : '▶' }}</span>
        <span class="group-sig">{{ g.signature }}</span>
        <span class="group-count">{{ g.entries.length }} records</span>
        <span class="group-desc">— {{ t('pareto_desc') }}</span>
      </div>

      <div v-if="g.expanded" class="group-body">
        <div v-for="(e, i) in g.entries" :key="i">
          <div class="entry-row" :class="{ selected: selected === e }" @click="compareMode ? toggleCompareEntry(e) : selectEntry(e)">
            <input v-if="compareMode" type="checkbox" :checked="compareList.includes(e)" class="compare-cb" @click.stop="toggleCompareEntry(e)" />
            <span class="entry-score">
              {{ e.record.score!.cost }}g/{{ e.record.score!.cycles }}c/{{ e.record.score!.area }}a/{{ e.record.score!.instructions }}i
              <span v-if="e.record.score!.height != null">/{{ e.record.score!.height }}h</span>
              <span v-if="e.record.score!.width != null">/{{ e.record.score!.width }}w</span>
              <span v-if="e.record.score!.rate != null">/{{ e.record.score!.rate }}r</span>
            </span>
            <span class="entry-tips">
              <span v-for="t in e.optimizations.slice(0, 3)" :key="t.key" class="tip-badge">{{ t.label }} {{ t.current }}(Best {{ t.target }}) Can <span class="tip-delta">↓{{ t.gap }}</span></span>
              <span v-if="e.optimizations.length === 0" class="tip-none">optimal</span>
            </span>
            <span class="entry-upgrades">
              <span v-for="(up, j) in e.upgrades.slice(0, 3)" :key="j" class="upgrade-tag">→{{ up.label }}</span>
            </span>
          </div>

          <!-- 展开对比 -->
          <div v-if="selected === e" class="compare-panel">
            <div class="compare-title">{{ t('pareto_compare_title') }}</div>
            <table class="compare-table">
              <thead>
                <tr>
                  <th>{{ t('pareto_dimension') }}</th>
                  <th class="col-cur">{{ t('pareto_current') }}</th>
                  <th v-for="(up, j) in e.upgrades" :key="j" class="col-up">→ {{ up.label }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="k in Object.keys(METRIC_LABELS).filter(k => getRaw(e.record.score!, k) != null)" :key="k">
                  <td class="dim-name">{{ METRIC_LABELS[k] }}</td>
                  <td class="val-cur">{{ fmtNum(getRaw(e.record.score!, k)!) }}</td>
                  <td v-for="(up, j) in e.upgrades" :key="j" class="val-up" :class="{ 'need-change': (up.targetVals[k] ?? Infinity) < (getRaw(e.record.score!, k) ?? 0) }">
                    <template v-if="up.targetVals[k] != null && up.targetVals[k] < (getRaw(e.record.score!, k) ?? Infinity)">
                      <span class="delta">↓{{ fmtNum((getRaw(e.record.score!, k) ?? 0) - up.targetVals[k]) }}</span>
                    </template>
                    <template v-else>
                      <span class="keep">—</span>
                    </template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pareto-container { padding: 16px 20px; max-width: 1000px; margin: 0 auto; color: #e0d8c8; font-family: 'JetBrains Mono', monospace; }
.pareto-header { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.pareto-title { color: #c9a84c; font-size: 0.82rem; font-weight: 700; font-family: 'Cinzel', serif; letter-spacing: 2px; }
.pareto-sub { color: #807860; font-size: 0.64rem; }
.hint { color: #807860; text-align: center; padding: 40px; font-size: 0.74rem; }
.compare-toggle {
  background: none; border: 1px solid rgba(201,168,76,0.2); color: #c9a84c;
  font-family: 'Cinzel', serif; font-size: 0.62rem; padding: 4px 12px; border-radius: 6px;
  cursor: pointer; margin-left: auto; letter-spacing: 1px;
  transition: all 0.2s ease;
}
.compare-toggle.active { background: rgba(201,168,76,0.12); color: #e2c96e; }
.compare-toggle:hover { background: rgba(201,168,76,0.12); color: #e2c96e; }

.group-card {
  background: rgba(26,23,18,0.5); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px; margin-bottom: 8px; overflow: hidden;
}
.group-header {
  display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  cursor: pointer; user-select: none; font-size: 0.7rem;
  transition: background 0.15s ease;
}
.group-header:hover { background: rgba(201,168,76,0.04); }
.group-arrow { color: #807860; font-size: 0.5rem; transition: transform 0.2s ease; }
.group-sig { color: #5aae6f; font-weight: 600; }
.group-count { color: #c9a84c; font-size: 0.64rem; }
.group-desc { color: #807860; font-size: 0.6rem; }
.group-body { border-top: 1px solid rgba(255,255,255,0.05); padding: 6px 12px 8px; }

.entry-row {
  display: grid; grid-template-columns: 260px 1fr 90px; align-items: center;
  gap: 8px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04);
  font-size: 0.66rem; cursor: pointer; border-radius: 4px;
  transition: background 0.15s ease;
}
.entry-row:hover { background: rgba(201,168,76,0.03); }
.entry-row.selected { background: rgba(201,168,76,0.06); border-color: rgba(201,168,76,0.2); }
.entry-row:last-child { border-bottom: none; }
.compare-cb { margin: 0; accent-color: #c9a84c; cursor: pointer; }
.entry-score { color: #e0d8c8; font-size: 0.64rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.entry-tips { display: flex; gap: 3px; justify-content: flex-start; }
.tip-badge { background: rgba(90,174,111,0.1); color: #e0d8c8; border: 1px solid rgba(90,174,111,0.2); border-radius: 4px; padding: 2px 5px; font-size: 0.58rem; white-space: nowrap; }
.tip-delta { color: #5aae6f; font-weight: 600; }
.tip-none { color: #5aae6f; font-size: 0.58rem; }
.entry-upgrades { display: flex; gap: 3px; justify-content: flex-end; }
.upgrade-tag { color: #e0d8c8; font-size: 0.58rem; background: rgba(201,168,76,0.08); border: 1px solid rgba(201,168,76,0.2); border-radius: 4px; padding: 2px 5px; white-space: nowrap; }

.compare-panel {
  margin: 6px 0 10px; padding: 10px 12px; background: rgba(0,0,0,0.2);
  border: 1px solid rgba(201,168,76,0.2); border-radius: 8px;
}
.compare-title { color: #c9a84c; font-size: 0.64rem; font-weight: 600; font-family: 'Cinzel', serif; letter-spacing: 1px; margin-bottom: 6px; }
.compare-table { width: 100%; border-collapse: collapse; font-size: 0.62rem; margin-bottom: 6px; }
.compare-table th { color: #807860; font-weight: 400; padding: 3px 6px; border-bottom: 1px solid rgba(255,255,255,0.08); text-align: center; font-family: 'Cinzel', serif; letter-spacing: 1px; }
.compare-table th:first-child { text-align: left; }
.compare-table td { padding: 3px 6px; border-bottom: 1px solid rgba(255,255,255,0.04); text-align: center; }
.dim-name { color: #807860; text-align: left !important; font-size: 0.6rem; }
.val-cur { color: #c9a84c; font-weight: 600; font-size: 0.62rem; }
.val-up { color: #807860; font-size: 0.6rem; }
.val-up.need-change { color: #e0d8c8; font-weight: 600; }
.col-cur { color: #c9a84c; font-size: 0.6rem; }
.col-up { color: #5aae6f; font-size: 0.6rem; }
.delta { color: #5aae6f; font-size: 0.58rem; font-weight: 600; }
.keep { color: #5a5245; font-size: 0.6rem; }

.compare-floating {
  position: sticky; top: 8px; z-index: 50;
  background: rgba(26,23,18,0.95); backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(201,168,76,0.25); border-radius: 10px;
  padding: 12px 14px; margin-bottom: 10px;
}
.compare-floating-header { display: flex; justify-content: space-between; align-items: center; font-size: 0.7rem; color: #c9a84c; font-weight: 600; font-family: 'Cinzel', serif; letter-spacing: 1px; margin-bottom: 6px; }
.compare-floating-header button { background: none; border: 1px solid rgba(255,255,255,0.1); color: #807860; cursor: pointer; font-size: 0.9rem; padding: 0 6px; border-radius: 4px; transition: all 0.2s ease; }
.compare-floating-header button:hover { color: #d45a4a; border-color: #d45a4a; }
.compare-floating-table { width: 100%; border-collapse: collapse; font-size: 0.66rem; margin-bottom: 6px; }
.compare-floating-table th { color: #807860; font-weight: 400; padding: 3px 8px; border-bottom: 1px solid rgba(255,255,255,0.08); text-align: center; font-family: 'Cinzel', serif; letter-spacing: 1px; }
.compare-floating-table th:first-child { text-align: left; }
.compare-floating-table td { padding: 3px 8px; border-bottom: 1px solid rgba(255,255,255,0.04); text-align: center; }
.c-a { color: #c9a84c; }
.c-b { color: #c47a5a; }
.delta-good { color: #5aae6f; font-weight: 600; }
.delta-bad { color: #d45a4a; font-weight: 600; }
.compare-chart2 { width: 100%; height: 25px; }
</style>
