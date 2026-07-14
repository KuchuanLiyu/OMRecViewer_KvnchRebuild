<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { t } from "../utils/i18n";
import { logInfo, logOk, logFail } from "../utils/logBus";

const props = defineProps<{
  visible: boolean;
  puzzleId: string;
  solution: string | null;
}>();
const emit = defineEmits<{ close: [] }>();

const iframeRef = ref<HTMLIFrameElement | null>(null);
const state = ref<"loading" | "sending" | "playing" | "error">("loading");
const errMsg = ref("");

let ready = false;
let loadSent = false;

function handleMessage(e: MessageEvent) {
  if (!e.data || typeof e.data !== "object") return;
  if (e.data.status === "ready" && !ready) {
    ready = true;
    logOk("WASM engine ready");
    sendLoad();
  } else if (e.data.status === "playing") {
    logOk("Replay started");
    state.value = "playing";
  }
}

async function sendLoad() {
  if (loadSent || !props.solution) {
    logFail("No solution URL available");
    return;
  }
  loadSent = true;
  state.value = "sending";
  logInfo(`Puzzle ID: ${props.puzzleId}`);

  try {
    // 1. Fetch puzzle bytes
    const puzzleBytes = await fetchPuzzleBytes(props.puzzleId);
    logOk(`Puzzle loaded (${puzzleBytes.length} bytes)`);

    // 2. Fetch solution content from ZLBB URL
    logInfo("Fetching solution from ZLBB...");
    const solResp = await fetch(`/api/proxy?url=${encodeURIComponent(props.solution)}`);
    if (!solResp.ok) throw new Error(`Solution fetch failed: HTTP ${solResp.status}`);
    const solutionBytes = new Uint8Array(await solResp.arrayBuffer());
    logOk(`Solution downloaded (${solutionBytes.length} bytes)`);

    // 3. Send to iframe
    iframeRef.value?.contentWindow?.postMessage(
      { command: "load", puzzle: puzzleBytes, solution: solutionBytes },
      "*"
    );
    logInfo("Data sent → iframe postMessage");
  } catch (err: any) {
    logFail(err.message || String(err));
    state.value = "error";
    errMsg.value = err.message || String(err);
  }
}

async function fetchPuzzleBytes(puzzleId: string): Promise<Uint8Array> {
  logInfo(`Fetching puzzle: ${puzzleId}`);
  const resp = await fetch(`/api/puzzle-file/${encodeURIComponent(puzzleId)}`);
  if (!resp.ok) {
    const altIds = [puzzleId, puzzleId.replace(/[^a-zA-Z0-9]/g, "_"), puzzleId.toLowerCase()];
    for (const alt of altIds) {
      const r2 = await fetch(`/api/puzzle-file/${encodeURIComponent(alt)}`);
      if (r2.ok) {
        const bytes = new Uint8Array(await r2.arrayBuffer());
        logOk(`Puzzle matched via alt: ${alt}`);
        return bytes;
      }
    }
    throw new Error(`Puzzle file not found: ${puzzleId}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}

function reset() {
  ready = false;
  loadSent = false;
  state.value = "loading";
  errMsg.value = "";
}

onMounted(() => {
  window.addEventListener("message", handleMessage);
});

onUnmounted(() => {
  window.removeEventListener("message", handleMessage);
  document.body.style.overflow = "";
});

watch(
  () => props.visible,
  (v) => {
    if (v) {
      logInfo(`[Modal] Opening. puzzleId="${props.puzzleId}" solution=${typeof props.solution} len=${props.solution?.length ?? 0}`);
      reset();
      document.addEventListener("keydown", onKeydown);
      document.body.style.overflow = "hidden";
    } else {
      document.removeEventListener("keydown", onKeydown);
      document.body.style.overflow = "";
    }
  }
);

function onIframeLoad() {
  // WASM init inside iframe will postMessage {status:'ready'} back
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="replay-overlay" @click.self="emit('close')">
      <div class="replay-container">
        <div class="replay-header">
          <span class="replay-title">▶ {{ t('replay_title') }}</span>
          <button class="replay-close" @click="emit('close')">×</button>
        </div>

        <!-- Loading / Error overlay -->
        <div v-if="state !== 'playing'" class="replay-status">
          <div v-if="state === 'loading'" class="status-block">
            <span class="spinner"></span>
            <span>{{ t('replay_loading') }}</span>
          </div>
          <div v-else-if="state === 'sending'" class="status-block">
            <span class="spinner"></span>
            <span>{{ t('replay_sending') }}</span>
          </div>
          <div v-else-if="state === 'error'" class="status-block error-block">
            <span>⚠ {{ t('replay_error') }}</span>
            <span class="err-detail">{{ errMsg }}</span>
          </div>
        </div>

        <iframe
          ref="iframeRef"
          src="/replay.html"
          class="replay-iframe"
          :class="{ loaded: state === 'playing' }"
          @load="onIframeLoad"
          allow="autoplay"
        ></iframe>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.replay-overlay {
  position: fixed; inset: 0; z-index: 500;
  background: rgba(0,0,0,0.88);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: flex; align-items: center; justify-content: center;
  animation: fadeIn 0.25s ease-out;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.replay-container {
  width: 95vw; max-width: 1400px; height: 88vh;
  background: rgba(20,17,11,0.96);
  border: 1px solid rgba(201,168,76,0.3);
  border-radius: 12px;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 64px rgba(0,0,0,0.8), 0 0 40px rgba(201,168,76,0.08);
  animation: scaleIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
  position: relative;
}
@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95) translateY(20px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.replay-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.06);
  flex-shrink: 0; z-index: 2;
}
.replay-title {
  font-family: 'Cinzel', serif; color: #e2c96e;
  font-size: 0.82rem; font-weight: 600; letter-spacing: 2px;
}
.replay-close {
  background: none; border: 1px solid rgba(255,255,255,0.1); color: #807860;
  font-size: 1.2rem; cursor: pointer; padding: 2px 10px; border-radius: 6px;
  line-height: 1; transition: all 0.2s ease;
}
.replay-close:hover { color: #d45a4a; border-color: #d45a4a; background: rgba(212,90,74,0.08); }

.replay-status {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  z-index: 10; pointer-events: none;
}
.status-block {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  color: #c9a84c; font-size: 0.8rem; font-family: 'JetBrains Mono', monospace;
}
.error-block { color: #d45a4a; }
.err-detail { font-size: 0.64rem; color: #807860; max-width: 520px; text-align: center; line-height: 1.5; }

.replay-iframe {
  flex: 1; width: 100%; border: none;
  opacity: 0; transition: opacity 0.4s ease;
}
.replay-iframe.loaded { opacity: 1; }

.spinner {
  width: 28px; height: 28px; border: 2px solid rgba(255,255,255,0.08);
  border-top-color: #c9a84c; border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
