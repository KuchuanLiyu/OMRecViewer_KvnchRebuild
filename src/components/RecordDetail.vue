<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import OmRadar from "./OmRadar.vue";
import type { OmRecordDTO, RadarChartData } from "../types/om";

const props = defineProps<{ record: OmRecordDTO | null }>();
const emit = defineEmits<{ close: [] }>();

const recordRadarChart = ref<RadarChartData | null>(null);
const radarLoading = ref(false);
const gifError = ref(false);
const gifLoading = ref(false);
const isVideo = computed(() => /\.(mp4|webm|mov)($|\?)/i.test(props.record?.gif || ""));
const gifRevealed = ref(false);
const gifCopying = ref(false);
const solSaving = ref(false);

async function saveSolution() {
  if (!props.record?.solution || solSaving.value) return;
  solSaving.value = true;
  try {
    await invoke("save_file_as", { url: props.record.solution, suffix: ".solution" });
  } catch (e) { console.error(e); }
  solSaving.value = false;
}

async function copyGifToClipboard() {
  if (!props.record?.gif || gifCopying.value) return;
  const url = props.record.gif;
  const isVid = /\.(mp4|webm|mov)($|\?)/i.test(url);
  if (isVid) {
    await invoke("save_file_as", { url });
    return;
  }
  gifCopying.value = true;
  try {
    const b64: string = await invoke("download_to_clipboard", { url });
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes]) })]);
  } catch (e) { console.error(e); }
  gifCopying.value = false;
}

watch(() => props.record, () => { gifError.value = false; gifLoading.value = false; gifRevealed.value = false; }, { immediate: true });

const RADAR_HIDDEN_KEY = "om_radar_hidden_metrics";
const radarHiddenMetrics = ref<Set<string>>(new Set(
  JSON.parse(localStorage.getItem(RADAR_HIDDEN_KEY) || "[]")
));

function toggleRadarMetric(k: string) {
  const next = new Set(radarHiddenMetrics.value);
  if (next.has(k)) next.delete(k); else next.add(k);
  radarHiddenMetrics.value = next;
  localStorage.setItem(RADAR_HIDDEN_KEY, JSON.stringify([...next]));
}

const filteredRadarChart = computed(() => {
  const src = recordRadarChart.value;
  if (!src) return null;
  const axes: Record<string, any> = {};
  const draftRaw: Record<string, number> = {};
  for (const k of Object.keys(src.axes)) {
    if (!radarHiddenMetrics.value.has(k)) {
      axes[k] = src.axes[k];
      if (src.draftRaw[k] !== undefined) draftRaw[k] = src.draftRaw[k];
    }
  }
  return { mode: src.mode, axes, draftRaw } as RadarChartData;
});

const onKeydown = (e: KeyboardEvent) => { if (e.key === "Escape") emit("close"); };
watch(() => props.record, (v) => {
  if (v) document.addEventListener("keydown", onKeydown);
  else document.removeEventListener("keydown", onKeydown);
}, { immediate: true });

watch(() => props.record, async (record) => {
  recordRadarChart.value = null;
  if (!record || !record.score) return;
  radarLoading.value = true;
  try {
    const hasInst = (record.score.instructions ?? 0) > 0;
    const mode = hasInst ? "GCAI" : "GCA";
    recordRadarChart.value = await invoke<RadarChartData>("get_record_radar_chart", {
      recordScore: record.score,
      puzzleId: record.puzzle?.id || "",
      mode,
    });
  } catch (err) {
    console.error("Failed to load record radar:", err);
  } finally {
    radarLoading.value = false;
  }
}, { immediate: true });

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
</script>

<template>
  <div v-if="record" class="detail-panel">
    <div class="detail-panel-hdr">
      <span class="detail-title">RECORD DETAIL</span>
      <div class="detail-hdr-right">
        <button class="detail-close" @click="emit('close')">×</button>
      </div>
    </div>
    <div class="detail-layout">
      <div class="detail-info">
        <div class="detail-meta-box">
          <span class="detail-label">AUTHOR</span>
          <span class="detail-value">{{ record.author || "—" }}</span>
          <span class="detail-label" style="margin-left:20px">UPDATED</span>
          <span class="detail-value">{{ formatDate(record.lastModified) }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">SOLUTION</span>
          <button class="copy-btn" @click="saveSolution" :disabled="!record.solution || solSaving">{{ solSaving ? 'SAVING…' : 'DOWNLOAD' }}</button>
        </div>
        <div v-if="recordRadarChart" class="radar-metric-toggles">
          <label v-for="k in ['cost','cycles','area','instructions','height','width','boundingHex','rate'].filter(k => recordRadarChart!.axes[k])" :key="k"
            class="radar-chip" :class="{ off: radarHiddenMetrics.has(k) }"
            @click="toggleRadarMetric(k)">
            {{ k }}
          </label>
        </div>
        <div class="detail-radar-bottom">
          <div v-if="radarLoading" class="radar-skeleton">LOADING...</div>
          <OmRadar v-else-if="filteredRadarChart" :chartData="filteredRadarChart" :puzzleName="record.puzzle?.displayName || ''" />
          <div v-else class="radar-skeleton">UNAVAILABLE</div>
        </div>
      </div>
      <div class="detail-right">
        <div class="detail-row" style="padding: 0;">
          <span class="detail-label">GIF</span>
          <button class="copy-btn" @click="copyGifToClipboard" :disabled="!record.gif || gifCopying">{{ gifCopying ? '...' : 'DOWNLOAD' }}</button>
        </div>
        <div class="gif-preview-box">
          <template v-if="record.gif && gifRevealed && !gifError">
            <video v-if="isVideo" :src="record.gif" class="gif-preview-img" autoplay loop muted playsinline
              @loadeddata="gifLoading = false" @error="gifError = true" />
            <img v-else :src="record.gif" class="gif-preview-img"
              @load="gifLoading = false" @error="gifError = true" />
            <div v-if="gifLoading" class="gif-preview-placeholder">LOADING...</div>
          </template>
          <div v-else-if="record.gif && !gifRevealed" class="gif-preview-placeholder clickable" @click="gifRevealed = true; gifLoading = true">VIEW SPOILER</div>
          <div v-else class="gif-preview-placeholder">NO PREVIEW</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail-panel { padding: 20px; flex: 1; display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
.detail-panel::-webkit-scrollbar { width: 4px; }
.detail-panel::-webkit-scrollbar-track { background: transparent; }
.detail-panel::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
.detail-panel-hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.detail-hdr-right { display: flex; align-items: center; gap: 10px; }
.detail-layout { display: flex; flex-direction: row; gap: 1.5rem; flex: 1; min-height: 0; align-items: stretch; }
.detail-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.detail-info::-webkit-scrollbar { width: 4px; }
.detail-info::-webkit-scrollbar-track { background: transparent; }
.detail-info::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
.detail-meta-box { background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 4px; padding: 8px 12px; display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.detail-meta-box .detail-label { min-width: 6em; }
.detail-meta-box .detail-value { flex: 1; }
.detail-radar-bottom { margin-top: auto; display: flex; align-items: flex-end; justify-content: flex-start; }
.detail-right { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.detail-row { display: flex; align-items: center; gap: 6px; padding: 4px 0 4px 12px; }
.detail-label { color: var(--color-text-muted); font-size: 0.78rem; min-width: 7em; text-align: left; }
.detail-value { color: var(--color-text); font-size: 0.85rem; }
.detail-title { color: var(--color-primary); font-size: 0.85rem; font-weight: bold; font-family: 'Cinzel', serif; letter-spacing: 1px; }
.detail-close { background: none; border: 1px solid var(--border-color); color: var(--color-text-muted); font-size: 1.2rem; cursor: pointer; padding: 2px 8px; border-radius: 3px; flex-shrink: 0; }
.detail-close:hover { color: var(--color-danger); border-color: var(--color-danger); }
.copy-btn { background: var(--bg-input); border: 1px solid var(--border-color); color: var(--color-text-muted); font-size: 0.72rem; padding: 2px 8px; border-radius: 3px; cursor: pointer; white-space: nowrap; flex-shrink: 0; font-family: 'Crimson Text', serif; }
.copy-btn:hover { color: var(--color-warn); border-color: var(--color-warn); }
.copy-btn:disabled { opacity: 0.3; }

.gif-preview-box { flex: 1; background: var(--bg-deep); border: 1px solid var(--border-color); border-radius: 4px; aspect-ratio: 826 / 647; width: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; }
.gif-preview-img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain; display: block; }
.gif-preview-placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.3); color: rgba(255,255,255,0.12); font-size: 1.4rem; font-family: 'Cinzel', serif; letter-spacing: 3px; user-select: none; }
.gif-preview-placeholder.clickable { cursor: pointer; color: rgba(255,255,255,0.2); white-space: nowrap; }
.gif-preview-placeholder.clickable:hover { color: rgba(255,255,255,0.4); background: rgba(0,0,0,0.4); }
.muted { color: var(--color-text-muted); }

.detail-radar-zone { margin-top: 16px; display: flex; justify-content: center; }
.radar-skeleton { width: 100%; max-width: 300px; height: 80px; display: flex; align-items: center; justify-content: center; border: 1px dashed var(--border-color); color: var(--color-text-muted); font-size: 0.72rem; border-radius: 4px; }
.radar-metric-toggles { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.radar-chip { background: rgba(0,180,216,0.08); border: 1px solid var(--color-primary); color: var(--color-primary); padding: 1px 7px; border-radius: 3px; cursor: pointer; font-family: monospace; font-size: 0.65rem; user-select: none; }
.radar-chip.off { background: transparent; border-color: var(--border-color); color: var(--color-text-muted); }

@media (max-width: 60rem) {
  .detail-layout { flex-direction: column; }
  .detail-info, .detail-right { flex: none; width: 100%; }
  .detail-info { max-height: 50vh; overflow-y: auto; }
  .detail-right { flex: 1; min-height: 0; }
}

@media (max-width: 40rem) {
  .detail-panel { padding: 12px; }
  .detail-panel-hdr { flex-direction: column; gap: 8px; align-items: flex-start; }
  .detail-meta-box { flex-wrap: wrap; }
}
</style>
