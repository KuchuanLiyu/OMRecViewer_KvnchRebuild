<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { OmRecordDTO, NavigatorResult } from "../types/om";

const props = defineProps<{ puzzleId: string; records: OmRecordDTO[]; filterTrackless: boolean; filterOverlap: boolean; puzzleName: string }>();

const ALL_DIMS = [
  { key: "cost", label: "G" }, { key: "cycles", label: "C" },
  { key: "area", label: "A" }, { key: "instructions", label: "I" },
  { key: "height", label: "H" }, { key: "width", label: "W" },
  { key: "boundingHex", label: "B" }, { key: "rate", label: "R" },
];
const DIM_LABELS: Record<string, string> = { cost: "G", cycles: "C", area: "A", instructions: "I", height: "H", width: "W", boundingHex: "B", rate: "R" };

const activeDims = ref<Set<string>>(new Set(["cost","cycles","area"]));
const heatX = ref("cost");
const heatY = ref("cycles");
const loading = ref(false);
const weakRecords = ref<{ record: OmRecordDTO; nav: NavigatorResult }[]>([]);
const selected = ref<{ record: OmRecordDTO; nav: NavigatorResult } | null>(null);
const error = ref<string | null>(null);
const lastScanKey = ref("");
const highlit = ref<OmRecordDTO | null>(null);
const heatCanvas = ref<HTMLCanvasElement | null>(null);
const heatCopying = ref(false);
const heatPoints = ref<{ x: number; y: number; record: OmRecordDTO; nav: NavigatorResult }[]>([]);
const heatTooltip = ref<{ x: number; y: number; text: string } | null>(null);
const navRight = ref<HTMLDivElement | null>(null);

watch(() => props.puzzleId, () => { weakRecords.value = []; lastScanKey.value = ""; highlit.value = null; });
watch(() => [props.filterTrackless, props.filterOverlap], () => { weakRecords.value = []; lastScanKey.value = ""; highlit.value = null; });
watch(() => props.records, () => { if (props.records.length) drawHeatmap(); });
onMounted(() => { drawHeatmap(); window.addEventListener("resize", drawHeatmap); });
onUnmounted(() => { window.removeEventListener("resize", drawHeatmap); });

function toggleDim(k: string) {
  const next = new Set(activeDims.value);
  if (next.has(k)) { if (next.size > 1) next.delete(k); } else next.add(k);
  activeDims.value = next;
  lastScanKey.value = "";
}

function setHeatX(k: string) { heatX.value = k; if (heatX.value === heatY.value) { const alt = ALL_DIMS.find(d => d.key !== k && activeDims.value.has(d.key)); if (alt) heatY.value = alt.key; } drawHeatmap(); }
function setHeatY(k: string) { heatY.value = k; if (heatX.value === heatY.value) { const alt = ALL_DIMS.find(d => d.key !== k && activeDims.value.has(d.key)); if (alt) heatX.value = alt.key; } drawHeatmap(); }

function highlightRecord(item: { record: OmRecordDTO; nav: NavigatorResult }) { highlit.value = highlit.value === item.record ? null : item.record; drawHeatmap(); }

async function scanAll() {
  if (!props.puzzleId || loading.value) return;
  const scanKey = props.puzzleId + "|" + [...activeDims.value].sort().join(",");
  if (scanKey === lastScanKey.value && weakRecords.value.length) return;
  lastScanKey.value = scanKey;
  loading.value = true; error.value = null; weakRecords.value = []; selected.value = null; highlit.value = null;
  const dims = [...activeDims.value];
  const all = props.records.filter(r => {
    if (!r.score || !(r.score.cost > 0 && r.score.cycles > 0 && r.score.area > 0 && r.score.instructions > 0)) return false;
    if (r.score.overlap !== props.filterOverlap) return false;
    if (props.filterTrackless && !r.score.trackless) return false;
    for (const d of dims) {
      if (d === "height" && r.score.height == null) return false;
      if (d === "width" && r.score.width == null) return false;
      if (d === "boundingHex" && r.score.boundingHex == null) return false;
      if (d === "rate" && r.score.rate == null) return false;
    }
    return true;
  });
  if (!all.length) { loading.value = false; return; }

  const n = all.length;
  const frontierIdx = new Set<number>();
  for (let i = 0; i < n; i++) {
    let dominated = false;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      let anyStrict = false, dominates = true;
      for (const d of dims) {
        const vi = (all[i].score as any)[d] ?? 0, vj = (all[j].score as any)[d] ?? 0;
        if (vi < vj - 1e-9) { dominates = false; break; }
        if (vj < vi - 1e-9) anyStrict = true;
      }
      if (dominates && anyStrict) { dominated = true; break; }
    }
    if (!dominated) frontierIdx.add(i);
  }

  const out: typeof weakRecords.value = [];
  for (const i of frontierIdx) {
    const rec = all[i]; const s = rec.score!;
    try {
      const nav = await invoke<NavigatorResult>("navigate_pareto", {
        draft: { cost: s.cost, cycles: s.cycles, area: s.area, instructions: s.instructions, height: s.height ?? null, width: s.width ?? null, boundingHex: s.boundingHex ?? null, rate: s.rate ?? null, overlap: s.overlap, trackless: s.trackless, active_metrics: dims },
        puzzleId: props.puzzleId,
      });
      out.push({ record: rec, nav });
    } catch (e) { error.value = String(e); break; }
  }
  out.sort((a, b) => b.nav.weaknessGap - a.nav.weaknessGap);
  weakRecords.value = out;
  loading.value = false;
  await nextTick();
  drawHeatmap();
}

async function copyHeatmap() {
  const c = heatCanvas.value; if (!c || heatCopying.value) return;
  heatCopying.value = true;
  try { c.toBlob(async (b) => { if (b) await navigator.clipboard.write([new ClipboardItem({"image/png": b})]); }, "image/png"); } catch (e) { console.error(e); }
  heatCopying.value = false;
}

function drawHeatmap() {
  const canvas = heatCanvas.value; if (!canvas) return;
  requestAnimationFrame(() => { if (canvas.parentElement && navRight.value) navRight.value.style.maxHeight = canvas.parentElement.offsetHeight + 'px'; });
  const ctx = canvas.getContext("2d")!;
  if (weakRecords.value.length < 2) { ctx.fillStyle = "#1a1a1a"; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
  const pts = weakRecords.value.map(item => ({ x: (item.record.score as any)[heatX.value] ?? 0, y: (item.record.score as any)[heatY.value] ?? 0, gap: item.nav.weaknessGap, rec: item.record, nav: item.nav })).filter(p => p.x > 0 && p.y > 0);
  if (pts.length < 2) return;
  const gapMax = pts.reduce((m, p) => Math.max(m, p.gap), 0) || 1;
  const gapMin = pts.reduce((m, p) => Math.min(m, p.gap), 0);
  const logX = pts.map(p => Math.log(p.x)), logY = pts.map(p => Math.log(p.y));
  const xMin = Math.min(...logX), xMax = Math.max(...logX), yMin = Math.min(...logY), yMax = Math.max(...logY);
  const dpr = window.devicePixelRatio || 1;
  const pw = canvas.parentElement!.clientWidth;
  const W = Math.max(pw, 300), H = Math.round(W * 0.76);
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + "px"; canvas.style.height = H + "px";
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#1a1a1a"; ctx.fillRect(0, 0, W, H);
  const pad = 40, padR = 80, padB = 40, padL = 50;
  function tx(x: number) { return padL + (Math.log(x) - xMin) / (xMax - xMin || 1) * (W - padL - padR); }
  function ty(y: number) { return H - padB - (Math.log(y) - yMin) / (yMax - yMin || 1) * (H - padB - pad); }

  ctx.strokeStyle = "#2d2d2d"; ctx.lineWidth = 0.5;
  for (let i = 0; i <= 5; i++) {
    const gx = padL + (W - padL - padR) * i / 5; ctx.beginPath(); ctx.moveTo(gx, pad); ctx.lineTo(gx, H - padB); ctx.stroke();
    const gy = pad + (H - padB - pad) * i / 5; ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke();
  }

  heatPoints.value = [];
  for (const p of pts) {
    const g = p.gap; let r: number, b: number;
    if (g >= 0) { const t = Math.min(g / (gapMax || 1), 1); r = Math.round(128 + 92 * t); b = Math.round(128 - 92 * t); }
    else { const t = Math.min(-g / (Math.abs(gapMin) || 1), 1); r = Math.round(128 - 92 * t); b = Math.round(128 + 92 * t); }
    ctx.fillStyle = `rgba(${r},80,${b},0.75)`;
    const sx = tx(p.x), sy = ty(p.y);
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI*2); ctx.fill();
    if (highlit.value && highlit.value === p.rec) { ctx.strokeStyle = "#e0c070"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI*2); ctx.stroke(); }
    heatPoints.value.push({ x: sx, y: sy, record: p.rec, nav: p.nav });
  }

  if (pts.length >= 3) {
    const front = pts.filter((a, i) => !pts.some((b, j) => i !== j && b.x <= a.x && b.y <= a.y && (b.x < a.x || b.y < a.y)));
    if (front.length >= 2) {
      const sorted = [...front].sort((a, b) => a.x - b.x);
      ctx.strokeStyle = "rgba(192,160,96,0.5)"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(tx(sorted[0].x), ty(sorted[0].y)); for (let i = 1; i < sorted.length; i++) ctx.lineTo(tx(sorted[i].x), ty(sorted[i].y));
      ctx.stroke(); ctx.setLineDash([]);
    }
  }

  ctx.fillStyle = "#a0a0a0"; ctx.font = "bold 13px 'Crimson Text', serif"; ctx.textAlign = "center";
  for (let i = 0; i <= 5; i++) { const v = Math.exp(xMin + (xMax - xMin) * i / 5); ctx.fillText(Number.isInteger(v) ? v.toString() : v.toFixed(0), padL + (W - padL - padR) * i / 5, H - padB + 14); }
  ctx.textAlign = "right";
  for (let i = 0; i <= 5; i++) { const v = Math.exp(yMin + (yMax - yMin) * i / 5); ctx.fillText(Number.isInteger(v) ? v.toString() : v.toFixed(0), padL - 6, H - padB - (H - padB - pad) * i / 5 + 3); }
  ctx.fillStyle = "#a0a0a0"; ctx.font = "bold 15px 'Cinzel', serif"; ctx.textAlign = "center";
  ctx.fillText(heatX.value, W / 2, H - 4);
  ctx.save(); ctx.translate(12, H / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(heatY.value, 0, 0); ctx.restore();

  const barX = W - padR + 10, barW = 14, barH = H - pad - padB, halfH = barH / 2;
  for (let i = 0; i < barH; i++) {
    let r: number, b: number;
    if (i >= halfH) { const t = (i - halfH) / halfH; r = Math.round(128 - 92 * t); b = Math.round(128 + 92 * t); }
    else { const t = (halfH - i) / halfH; r = Math.round(128 + 92 * t); b = Math.round(128 - 92 * t); }
    ctx.fillStyle = `rgba(${r},80,${b},1)`; ctx.fillRect(barX, pad + i, barW, 1);
  }
  ctx.strokeStyle = "#3d3d3d"; ctx.strokeRect(barX, pad, barW, barH);
  ctx.fillStyle = "#a0a0a0"; ctx.font = "bold 11px 'Crimson Text', serif"; ctx.textAlign = "left";
  ctx.fillText(gapMax.toFixed(4), barX + barW + 4, pad + 10);
  ctx.fillText("0", barX + barW + 4, pad + halfH + 4);
  ctx.fillText(gapMin.toFixed(4), barX + barW + 4, pad + barH - 4);
}

function onHeatMove(e: MouseEvent) {
  const c = heatCanvas.value; if (!c || !heatPoints.value.length) return;
  const rect = c.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
  const sx = (e.clientX - rect.left) * (c.width / rect.width / dpr), sy = (e.clientY - rect.top) * (c.height / rect.height / dpr);
  const near = heatPoints.value.find(p => Math.hypot(p.x - sx, p.y - sy) < 8);
  if (near) { heatTooltip.value = { x: e.clientX - rect.left + 12, y: e.clientY - rect.top - 10, text: [...activeDims.value].map(d => `${(near.record.score as any)[d]}${DIM_LABELS[d]}`).join("/") + `  gap:${near.nav.weaknessGap.toFixed(4)}` }; }
  else { heatTooltip.value = null; }
}

function onHeatClick(e: MouseEvent) {
  const c = heatCanvas.value; if (!c || !heatPoints.value.length) return;
  const rect = c.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
  const sx = (e.clientX - rect.left) * (c.width / rect.width / dpr), sy = (e.clientY - rect.top) * (c.height / rect.height / dpr);
  const near = heatPoints.value.find(p => Math.hypot(p.x - sx, p.y - sy) < 8);
  if (near) {
    const found = weakRecords.value.find(w => w.record === near.record);
    if (found) { highlit.value = highlit.value === near.record ? null : near.record; drawHeatmap(); const idx = weakRecords.value.indexOf(found); const row = navRight.value?.querySelector(`[data-idx="${idx}"]`) as HTMLElement; row?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  }
}
</script>

<template>
  <div class="nav-panel">
    <div class="nav-header"><span class="nav-title">PARETO NAVIGATOR</span><span v-if="props.puzzleId" class="nav-puzzle">#{{ props.puzzleId }}</span></div>
    <div class="dim-row"><span class="dim-label">DIMS:</span><label v-for="d in ALL_DIMS" :key="d.key" class="dim-chip" :class="{ on: activeDims.has(d.key) }"><input type="checkbox" :checked="activeDims.has(d.key)" @change="toggleDim(d.key)"/>{{ d.label }}</label></div>
    <button class="nav-btn" :class="{ loading }" :disabled="loading || !props.puzzleId" @click="scanAll">{{ loading ? 'SCANNING…' : 'SCAN ALL' }}</button>
    <p v-if="error" class="err">⚠ {{ error }}</p>

    <div class="nav-body" v-if="weakRecords.length">
      <div class="nav-left">
        <div class="heatmap-section">
          <div class="heatmap-header"><span class="heatmap-title">2D SCATTER</span></div>
          <div class="heatmap-axis-row"><span class="dim-label">X:</span><label v-for="d in ALL_DIMS" :key="'x'+d.key" v-show="activeDims.has(d.key)" class="heat-chip" :class="{ on: heatX === d.key }" @click="setHeatX(d.key)">{{ d.label }}</label></div>
          <div class="heatmap-axis-row"><span class="dim-label">Y:</span><label v-for="d in ALL_DIMS" :key="'y'+d.key" v-show="activeDims.has(d.key)" class="heat-chip" :class="{ on: heatY === d.key }" @click="setHeatY(d.key)">{{ d.label }}</label></div>
          <div class="heat-canvas-wrap">
            <canvas ref="heatCanvas" class="heat-canvas" @mousemove="onHeatMove" @mouseleave="heatTooltip=null" @click="onHeatClick"></canvas>
            <button class="heat-copy-btn" @click="copyHeatmap" :disabled="heatCopying">{{ heatCopying ? '...' : 'COPY' }}</button>
            <div v-if="heatTooltip" class="heat-tooltip" :style="{ left: heatTooltip.x+'px', top: heatTooltip.y+'px' }">{{ heatTooltip.text }}</div>
          </div>
        </div>
      </div>
      <div class="nav-right-col">
        <div class="weak-count">{{ weakRecords.length }} frontier records (sorted by gap)</div>
        <div class="nav-right" ref="navRight">
          <div v-for="(item, i) in weakRecords" :key="i" :data-idx="i" class="weak-row" :class="{ sel: selected === item, weakbg: item.nav.isWeak, strongbg: !item.nav.isWeak, hlit: highlit === item.record }" @click="highlightRecord(item)">
            <span class="weak-score">{{ [...activeDims].map(d => `${(item.record.score as any)[d]}${DIM_LABELS[d]}`).join("/") }}</span>
            <div class="weak-btns"><button class="weak-plus" @click.stop="selected = selected === item ? null : item">+</button></div>
          </div>
        </div>
      </div>
    </div>
    <p v-else-if="!loading && weakRecords.length === 0 && !error" class="nav-empty">No frontier records found.</p>

    <div v-if="selected" class="nav-overlay" @click.self="selected = null">
      <div class="nav-modal">
        <div class="nav-modal-hdr"><div></div><div class="nav-modal-acts"><button @click="selected = null" class="nav-close-btn">×</button></div></div>
        <div class="nav-vector"><span class="vl">Target Δ:</span><span v-for="d in [...activeDims]" :key="d" class="vi">{{ (selected.nav.deltaMetrics[d] >= 0 ? '+' : '') + (selected.nav.deltaMetrics[d] % 1 === 0 ? selected.nav.deltaMetrics[d] : selected.nav.deltaMetrics[d].toFixed(1)) }}{{ DIM_LABELS[d] }}</span></div>
        <div v-if="selected.nav.lambdaAllies.length > 0" class="cmp-table-wrap">
          <table class="cmp-table"><thead><tr><th></th><th v-for="d in [...activeDims]" :key="d">{{ DIM_LABELS[d] }}</th></tr></thead>
            <tbody>
              <tr class="draft"><td>NOW</td><td v-for="d in [...activeDims]" :key="d">{{ (selected.record.score as any)?.[d] ?? '—' }}</td></tr>
              <tr class="target"><td>TARGET</td><td v-for="d in [...activeDims]" :key="d">{{ ((selected.record.score as any)?.[d] + (selected.nav.deltaMetrics[d] || 0)).toFixed(1) }}</td></tr>
              <tr v-for="(ally, ai) in selected.nav.lambdaAllies" :key="ai" class="ally"><td><span class="aw">{{ (ally.weight * 100).toFixed(0) }}%</span> {{ ally.author || ally.recordId }}</td><td v-for="d in [...activeDims]" :key="d">{{ ally.metricValues[d] ?? '—' }}</td></tr>
            </tbody></table>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nav-panel { background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 6px; padding: 16px; font-family: monospace; overflow: hidden; }
.nav-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
.nav-title { color: var(--color-primary); font-size: 0.82rem; font-weight: bold; font-family: 'Cinzel', serif; letter-spacing: 0.5px; }
.nav-puzzle { color: var(--color-accent); font-size: 0.72rem; }
.dim-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 8px; }
.dim-label { color: var(--color-text-muted); font-size: 0.65rem; font-weight: bold; margin-right: 4px; }
.dim-chip { background: var(--bg-deep); border: 1px solid var(--border-color); color: var(--color-text-muted); padding: 2px 7px; border-radius: 3px; cursor: pointer; font-size: 0.68rem; user-select: none; }
.dim-chip input { display: none; }
.dim-chip.on { background: rgba(224,192,112,0.08); border-color: var(--color-accent); color: var(--color-accent); font-weight: bold; }
.nav-btn { width: 100%; padding: 10px; margin-bottom: 12px; background: var(--color-accent); color: var(--bg-deep); border: none; border-radius: 4px; font: inherit; font-size: 0.85rem; font-weight: bold; cursor: pointer; }
.nav-btn:hover:not(:disabled) { background: var(--color-warn); }
.nav-btn:disabled { opacity: 0.45; }
.nav-btn.loading { background: var(--border-color); color: var(--color-text-muted); }
.nav-body { display: grid; grid-template-columns: 2fr 1fr; gap: 1rem; align-items: start; }
.nav-left { min-width: 0; }
.nav-right-col { min-width: 0; display: flex; flex-direction: column; padding-top: 1.2cm; }
.nav-right { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
.nav-right::-webkit-scrollbar { width: 4px; }
.nav-right::-webkit-scrollbar-track { background: transparent; }
.nav-right::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
.weak-count { color: var(--color-warn); font-size: 0.7rem; font-weight: bold; padding: 0 0 4px 0; margin-bottom: 4px; border-bottom: 1px solid var(--bg-input); flex-shrink: 0; }
.weak-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 8px; border-radius: 3px; cursor: pointer; border: 1px solid transparent; }
.weak-row:hover { background: var(--bg-input); }
.weak-row.sel { border-color: rgba(167,139,250,0.5); background: rgba(167,139,250,0.06); }
.weak-row.hlit { border-color: var(--color-accent); background: rgba(224,192,112,0.1); }
.weak-row.strongbg { background: rgba(60,60,220,0.08); }
.weak-row.weakbg { background: rgba(220,60,60,0.12); }
.weak-score { color: var(--color-text); font-size: 0.68rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.weak-btns { display: flex; gap: 2px; flex-shrink: 0; }
.weak-plus { background: none; border: 1px solid var(--border-color); color: var(--color-text-muted); font-size: 0.8rem; cursor: pointer; padding: 0 5px; border-radius: 3px; line-height: 1; }
.weak-plus:hover { border-color: var(--color-accent); color: var(--color-accent); }
.nav-empty { color: var(--color-text-muted); font-size: 0.7rem; text-align: center; padding: 12px 0; }
.err { color: var(--color-danger); font-size: 0.7rem; margin-top: 8px; }
.heatmap-section { margin-top: 0; border-top: none; padding-top: 0; }
.heatmap-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.heatmap-title { color: var(--color-text-muted); font-size: 0.65rem; font-weight: bold; }
.heatmap-axis-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 6px; }
.heat-chip { background: var(--bg-deep); border: 1px solid var(--border-color); color: var(--color-text-muted); padding: 3px 10px; border-radius: 3px; cursor: pointer; font-size: 0.72rem; user-select: none; font-weight: bold; }
.heat-chip.on { background: rgba(192,160,96,0.15); border-color: var(--color-accent); color: var(--color-accent); }
.heat-canvas-wrap { position: relative; }
.heat-canvas { width: 100%; display: block; border-radius: 4px; }
.heat-copy-btn { position: absolute; top: 4px; right: 4px; z-index: 1; background: rgba(0,0,0,0.6); border: 1px solid var(--border-color); color: var(--color-text-muted); font-family: 'Crimson Text', serif; font-size: 0.65rem; padding: 2px 8px; border-radius: 3px; cursor: pointer; }
.heat-copy-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.heat-tooltip { position: absolute; background: rgba(0,0,0,0.85); color: var(--color-accent); font-family: 'Crimson Text', monospace; font-size: 0.68rem; padding: 4px 8px; border-radius: 3px; pointer-events: none; white-space: nowrap; z-index: 10; }
.nav-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 200; display: flex; align-items: center; justify-content: center; }
.nav-modal { background: var(--bg-panel); border: 1px solid var(--color-primary); border-radius: 6px; padding: 20px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; font-family: monospace; }
.nav-modal-hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.nav-modal-acts { display: flex; gap: 6px; }
.nav-close-btn { background: none; border: 1px solid var(--color-text-muted); color: var(--color-text-muted); font-size: 1rem; cursor: pointer; padding: 0 6px; border-radius: 3px; line-height: 1; }
.nav-close-btn:hover { border-color: var(--color-danger); color: var(--color-danger); }
.nav-vector { color: var(--color-warn); font-size: 0.68rem; margin-bottom: 8px; }
.vl { color: var(--color-text-muted); margin-right: 4px; }
.vi { color: var(--color-accent); margin: 0 2px; }
.cmp-table-wrap { margin-top: 6px; overflow-x: auto; }
.cmp-table { width: 100%; border-collapse: collapse; font-size: 0.7rem; }
.cmp-table th { color: var(--color-text-muted); text-align: right; padding: 3px 8px; border-bottom: 1px solid var(--bg-input); white-space: nowrap; }
.cmp-table td { text-align: right; padding: 3px 8px; white-space: nowrap; color: var(--color-text); }
.cmp-table td:first-child { text-align: left; }
.draft td { color: var(--color-danger); }
.target td { color: var(--color-accent); font-weight: bold; }
.ally td { color: var(--color-primary); }
.aw { color: var(--color-warn); font-weight: bold; }

@media (max-width: 50rem) {
  .nav-body { grid-template-columns: 1fr; }
  .nav-right-col { padding-top: 0; }
  .nav-right { max-height: 280px; }
}
</style>
