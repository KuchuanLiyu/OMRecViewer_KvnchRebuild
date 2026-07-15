<script setup lang="ts">
import { ref, watch, computed } from "vue";
import OmList from "./components/OmList.vue";
import PuzzleBrowser from "./components/PuzzleBrowser.vue";
import HomeDashboard from "./components/HomeDashboard.vue";
import type { OmRecordDTO } from "./types/om";
import type { UniversalSuggestion } from "./api/omApi";
import { searchOmRecords, getLivePuzzleSuggestions, checkBootReady, getCachePath, getCacheInfo } from "./api/omApi";
import { t, locale, type Locale } from "./utils/i18n";
import { logBus } from "./utils/logBus";
const logOpen = ref(false);
const lastLog = computed(() => logBus.length > 0 ? logBus[logBus.length - 1] : null);
watch(locale, (v) => { document.documentElement.lang = v; }, { immediate: true });

const searchKeyword = ref<string>("");
const suggestions = ref<UniversalSuggestion[]>([]);
const showSuggestions = ref<boolean>(false);
const recentSearches = ref<{id:string;name:string}[]>([]);
function loadRecentSearches() {
  try { const raw = localStorage.getItem("recentPuzzles"); if (raw) recentSearches.value = JSON.parse(raw).slice(0,5); }
  catch { recentSearches.value = []; }
}
loadRecentSearches();

const currentRecords = ref<OmRecordDTO[]>([]);
const dashRef = ref<InstanceType<typeof HomeDashboard> | null>(null);
const loading = ref<boolean>(false);
const errorMessage = ref<string | null>(null);
const hasSearched = ref<boolean>(false);
const cachePath = ref("");
const cacheInfo = ref("");
const forceRefresh = ref(false);
const lastKeyword = ref("");

const updateCacheInfo = async () => {
  try { cacheInfo.value = await getCacheInfo(); } catch { cacheInfo.value = "?"; }
};

const executeRefresh = () => {
  if (lastKeyword.value) {
    executeFinalQuery(lastKeyword.value);
  }
};

// fetch cache path on mount
getCachePath().then(p => cachePath.value = p);
updateCacheInfo();
const bootReady = ref<boolean>(false);

watch(searchKeyword, async (newVal) => {
  const query = newVal.trim();
  if (!query) {
    suggestions.value = [];
    return;
  }
  try {
    suggestions.value = await getLivePuzzleSuggestions(query);
  } catch (err) {
    console.error(err);
  }
});

const selectSuggestion = (puzzle: UniversalSuggestion) => {
  searchKeyword.value = puzzle.displayName;
  showSuggestions.value = false;
  executeFinalQuery(puzzle.id);
};

const handleEnterKey = () => {
  showSuggestions.value = false;
  const query = searchKeyword.value.trim();
  if (!query) return;
  const bestMatch = suggestions.value.find(
    s => s.displayName.toLowerCase() === query.toLowerCase()
  ) ?? suggestions.value.find(
    s => s.displayName.toLowerCase().includes(query.toLowerCase())
  );
  executeFinalQuery(bestMatch?.id ?? query);
};

const executeFinalQuery = async (puzzleId: string) => {
  if (!puzzleId) return;
  lastKeyword.value = puzzleId;
  loading.value = true;
  errorMessage.value = null;
  hasSearched.value = true;

  try {
    currentRecords.value = await searchOmRecords(puzzleId, forceRefresh.value);
    dashRef.value?.addRecent(puzzleId, currentRecords.value[0]?.puzzle?.displayName ?? puzzleId);
    loadRecentSearches();
  } catch (err) {
    errorMessage.value = String(err);
  } finally {
    loading.value = false;
    forceRefresh.value = false;
    updateCacheInfo();
  }
};

// poll backend boot status
const pollBootReady = async () => {
  while (!bootReady.value) {
    try {
      const ready = await checkBootReady();
      if (ready) bootReady.value = true;
    } catch { /* ignore polling error */ }
    await new Promise(r => setTimeout(r, 300));
  }
};
pollBootReady();

const closeSuggestions = () => {
  setTimeout(() => { showSuggestions.value = false; }, 200);
};
</script>

<template>
  <div class="app-container">
    <aside class="sidebar-panel">
      <div class="brand-zone">
        <div class="logo-icon">
          <img src="/icon.png" alt="Opus Magnum" class="logo-img" />
        </div>
        <div class="brand-text">
          <h2>{{ t('brand_title') }}</h2>
          <span class="brand-subtitle">{{ t('brand_sub') }}</span>
        </div>
      </div>
      <hr class="divider" />

      <div class="control-group">
        <div class="input-container">
          <input
            type="text" v-model="searchKeyword"
            :placeholder="t('placeholder_search')"
            @keyup.enter="handleEnterKey" @focus="showSuggestions = true" @blur="closeSuggestions"
            :disabled="loading" class="cyber-input"
          />
          <ul v-if="showSuggestions && (suggestions.length > 0 || !searchKeyword.trim())" class="suggestions-menu">
            <template v-if="!searchKeyword.trim() && recentSearches.length > 0">
              <li class="sug-header">Recent</li>
              <li v-for="r in recentSearches" :key="r.id" @mousedown="executeFinalQuery(r.id); showSuggestions=false" class="suggestion-item recent-item">
                <span class="s-name">{{ r.name }}</span>
                <span class="s-id">#{{ r.id }}</span>
              </li>
            </template>
            <template v-else>
            <li v-for="s in suggestions" :key="s.id" @mousedown="selectSuggestion(s)" class="suggestion-item">
              <span class="s-name">{{ s.displayName }}</span>
              <span class="s-id">[{{ s.controller.toUpperCase() }}] #{{ s.id }}</span>
            </li>
            </template>
          </ul>
        </div>
        <div class="search-actions">
          <button @click="handleEnterKey" :disabled="loading || !searchKeyword.trim()" class="btn-execute">{{ t('btn_execute') }}</button>
          <button @click="forceRefresh = !forceRefresh; if (forceRefresh) executeRefresh()" class="btn-refresh" :class="{ active: forceRefresh }">{{ t('btn_refresh') }}</button>
        </div>
      </div>
      <hr class="divider" />

      <PuzzleBrowser @select="selectSuggestion" />
      <hr class="divider" />

      <!-- Language pill toggle -->
      <div class="lang-zone">
        <div class="lang-pills">
          <button v-for="opt in (['en','zh','ja'] as Locale[])" :key="opt"
            class="lang-pill" :class="{ active: locale === opt }"
            @click="locale = opt"
          >{{ opt === 'en' ? 'EN' : opt === 'zh' ? '中文' : '日本語' }}</button>
        </div>
      </div>

      <!-- Status ring -->
      <div class="status-zone">
        <div class="status-ring" :class="{ 'is-loading': loading, 'is-error': errorMessage, 'is-syncing': !bootReady }">
          <svg viewBox="0 0 40 40" class="status-svg">
            <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" stroke-width="2" opacity="0.15"/>
            <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" stroke-width="2"
              stroke-dasharray="100" :stroke-dashoffset="bootReady ? 0 : 60"
              style="transition: stroke-dashoffset 0.6s ease" opacity="0.8"/>
          </svg>
          <span class="status-label">{{ !bootReady ? t('status_syncing') : loading ? t('status_fetching') : errorMessage ? t('status_error') : t('status_ready') }}</span>
        </div>
        <p v-if="errorMessage" class="error-details">> {{ errorMessage }}</p>
        <p class="cache-path">{{ t('cache_label') }} {{ cachePath }}</p>
        <p class="cache-path">{{ cacheInfo }}</p>
      </div>
    </aside>
    <main class="main-workspace">
      <header class="workspace-header">
        <div class="header-left">
          <span class="hdr-icon">⬡</span>
          <div class="breadcrumb">{{ t('breadcrumb') }}</div>
        </div>
        <div class="header-right">
          <span class="hdr-dot"></span>
          <span class="timestamp">{{ t('sys_online') }}</span>
        </div>
      </header>
      <section class="data-view-panel">
        <HomeDashboard v-if="!hasSearched" ref="dashRef" @search="(id: string) => executeFinalQuery(id)" />
        <OmList v-else :records="currentRecords" />
      </section>

      <!-- Collapsible log panel -->
      <div class="log-float" :class="{ open: logOpen }">
        <button class="log-toggle" @click="logOpen = !logOpen" :title="logOpen ? 'Collapse' : 'Expand log'">
          <span class="log-dot" :class="{ 'log-dot-ok': lastLog?.ok === true, 'log-dot-fail': lastLog?.ok === false }"></span>
          <span class="log-label">{{ lastLog?.msg ?? 'Log' }}</span>
          <span class="log-chevron" :class="{ open: logOpen }">▶</span>
        </button>
        <div v-if="logOpen" class="log-body">
          <div v-if="logBus.length === 0" class="log-empty">No events yet</div>
          <div v-for="(entry, i) in logBus.slice(-12)" :key="i" class="log-line"
            :class="{ 'log-ok': entry.ok === true, 'log-fail': entry.ok === false }">
            <span class="log-time">{{ entry.time }}</span>
            <span class="log-msg">{{ entry.msg }}</span>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style>
/* ══════════════════════════════════════════════
   Opus Magnum — Alchemical Data Terminal v2
   ══════════════════════════════════════════════ */
:root {
  --bg-deepest:       #0b0a08;
  --bg-deep:          #12100d;
  --bg-panel:         #1a1712;
  --bg-glass:         rgba(26, 23, 18, 0.85);
  --bg-input:         #1e1b15;
  --bg-hover:         #282318;
  --border-subtle:    rgba(255,255,255,0.05);
  --border-color:     rgba(255,255,255,0.08);
  --border-gold:      rgba(201,168,76,0.25);
  --border-gold-solid:#5a4a2a;
  --gold:             #c9a84c;
  --gold-light:       #e2c96e;
  --gold-dim:         #8a7030;
  --copper:           #c47a5a;
  --text:             #e6dfcf;
  --text-muted:       #a09888;
  --text-dim:         #706858;
  --ember:            #d45a4a;
  --verdant:          #5aae6f;
  --parchment:        #d4c8a8;
  --radius-sm:        6px;
  --radius-md:        8px;
  --radius-lg:        12px;
  --shadow-panel:     0 2px 16px rgba(0,0,0,0.5), 0 0 0 1px rgba(201,168,76,0.06);
  --shadow-elevated:  0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(201,168,76,0.1);
  --ease-out:         cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out:      cubic-bezier(0.65, 0, 0.35, 1);
}

body {
  margin: 0; padding: 0;
  background-color: var(--bg-deepest);
  color: var(--text);
  font-family: 'JetBrains Mono', monospace;
  font-size: 15px;
  line-height: 1.55;
  overflow: hidden;
}

/* ── CJK typography: cleaner sans-serif ── */
:lang(zh) .brand-text h2,
:lang(zh) .brand-text span,
:lang(zh) .section-label,
:lang(zh) .btn-execute,
:lang(zh) .breadcrumb,
:lang(zh) .ap-title,
:lang(zh) .ellipsoid-title,
:lang(zh) .ap-list-hdr,
:lang(zh) .detail-title,
:lang(zh) .improve-title,
:lang(zh) .hull-title,
:lang(zh) .pareto-title,
:lang(zh) .mode-btn,
:lang(zh) th {
  font-family: 'Noto Sans SC', 'Ma Shan Zheng', sans-serif !important;
  font-weight: 600 !important;
}
:lang(ja) .brand-text h2,
:lang(ja) .brand-text span,
:lang(ja) .section-label,
:lang(ja) .btn-execute,
:lang(ja) .breadcrumb,
:lang(ja) .ap-title,
:lang(ja) .ellipsoid-title,
:lang(ja) .ap-list-hdr,
:lang(ja) .detail-title,
:lang(ja) .improve-title,
:lang(ja) .hull-title,
:lang(ja) .pareto-title,
:lang(ja) .mode-btn,
:lang(ja) th {
  font-family: 'Noto Sans SC', sans-serif !important;
  font-weight: 600 !important;
}

/* ── Layout ── */
.app-container {
  display: grid;
  grid-template-columns: 320px 1fr;
  height: 100vh; width: 100vw;
}

/* ── Sidebar ── */
.sidebar-panel {
  background: var(--bg-panel);
  border-right: 1px solid var(--border-gold);
  padding: 22px 18px;
  display: flex; flex-direction: column; gap: 18px;
  box-shadow: 2px 0 20px rgba(0,0,0,0.3);
  z-index: 10;
}

.brand-zone { display: flex; align-items: center; gap: 12px; }
.logo-icon { width: 36px; height: 36px; flex-shrink: 0; filter: drop-shadow(0 0 8px rgba(201,168,76,0.3)); }
.logo-img { width: 100%; height: 100%; object-fit: contain; }
.brand-text h2 {
  margin: 0; font-size: 0.9rem; font-weight: 700;
  font-family: 'Cinzel', serif;
  color: var(--gold-light, #e2c96e);
  letter-spacing: 3px;
}
.brand-subtitle {
  font-size: 0.52rem; font-weight: 600;
  font-family: 'Cinzel', serif;
  color: #5a4a2a;
  letter-spacing: 2.5px;
  text-transform: uppercase;
}

.divider { border: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(201,168,76,0.2), transparent); margin: 0; }

/* ── Search ── */
.input-container { position: relative; width: 100%; }
.search-actions { display: flex; gap: 6px; margin-top: 6px; }
.cyber-input {
  width: 100%; background: rgba(0,0,0,0.25);
  border: 1px solid rgba(255,255,255,0.08);
  color: var(--text, #e0d8c8); padding: 9px 12px;
  border-radius: 8px; box-sizing: border-box;
  font-size: 0.76rem; font-family: 'JetBrains Mono', monospace;
  outline: none;
  transition: border-color 0.25s ease, box-shadow 0.25s ease;
}
.cyber-input:focus { border-color: #c9a84c; box-shadow: 0 0 0 2px rgba(201,168,76,0.1); }
.cyber-input::placeholder { color: #706858; }

.btn-execute {
  flex: 1; background: rgba(201,168,76,0.12); color: #e2c96e;
  border: 1px solid rgba(201,168,76,0.25); padding: 8px; border-radius: 8px;
  font-weight: 600; cursor: pointer; font-family: 'Cinzel', serif; font-size: 0.62rem;
  letter-spacing: 2px; transition: all 0.25s ease;
}
.btn-execute:hover:not(:disabled) { background: rgba(201,168,76,0.2); transform: translateY(-1px); }
.btn-execute:disabled { opacity: 0.3; cursor: not-allowed; }
.btn-refresh {
  background: none; color: #706858; border: 1px solid rgba(255,255,255,0.06);
  padding: 8px 10px; border-radius: 8px; font-family: 'Cinzel', serif;
  font-size: 0.58rem; cursor: pointer; letter-spacing: 1px;
  transition: all 0.25s ease;
}
.btn-refresh:hover { border-color: rgba(255,255,255,0.15); color: #a09888; }
.btn-refresh.active { background: rgba(196,122,90,0.15); border-color: rgba(196,122,90,0.3); color: #e8a080; }

.suggestions-menu {
  position: absolute; top: calc(100% + 4px); left: 0; width: 100%;
  background: rgba(20,17,11,0.96); border: 1px solid rgba(201,168,76,0.2);
  border-radius: 8px; padding: 0; margin: 0; list-style: none;
  z-index: 999; max-height: 200px; overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  backdrop-filter: blur(12px);
}
.suggestion-item {
  padding: 9px 12px; cursor: pointer; display: flex;
  justify-content: space-between; align-items: center;
  font-size: 0.72rem; border-bottom: 1px solid rgba(255,255,255,0.04);
  transition: background 0.15s ease;
}
.sug-header { padding: 6px 12px 4px; font-size: 0.55rem; color: #5a5245; font-family: 'Cinzel', serif; letter-spacing: 2px; text-transform: uppercase; }
.suggestion-item:last-child { border-bottom: none; }
.suggestion-item:hover { background: rgba(201,168,76,0.06); }
.recent-item .s-id { color: #706858; }
.s-name { color: #e0d8c8; }
.s-id { color: #8a7030; font-size: 0.6rem; }

/* ── Language pill toggle ── */
.lang-zone { margin: 0; }
.lang-pills {
  display: flex; background: rgba(0,0,0,0.25);
  border-radius: 8px; padding: 3px; border: 1px solid rgba(255,255,255,0.06);
}
.lang-pill {
  flex: 1; background: none; border: none; color: #706858;
  padding: 6px 2px; border-radius: 6px; cursor: pointer;
  font-family: 'JetBrains Mono', monospace; font-size: 0.62rem; font-weight: 500;
  transition: all 0.25s ease;
}
.lang-pill.active {
  background: rgba(201,168,76,0.12); color: #e2c96e;
  box-shadow: 0 1px 4px rgba(0,0,0,0.3);
}
.lang-pill:hover:not(.active) { color: #a09888; }

/* ── Status ring ── */
.status-zone { margin-top: 4px; }
.status-ring {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; background: rgba(0,0,0,0.15);
  border-radius: 10px; border: 1px solid rgba(255,255,255,0.05);
}
.status-svg { width: 28px; height: 28px; flex-shrink: 0; color: #5aae6f; }
.status-ring.is-syncing .status-svg { color: #c9a84c; animation: ringPulse 1.5s ease-in-out infinite; }
.status-ring.is-loading .status-svg { color: #c9a84c; animation: ringSpin 2s linear infinite; }
.status-ring.is-error .status-svg { color: #d45a4a; }
@keyframes ringPulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
@keyframes ringSpin { to { transform: rotate(360deg); } }
.status-label { font-size: 0.64rem; font-family: 'JetBrains Mono', monospace; color: #807860; }

/* ── Status ── */
.status-card {
  background: var(--bg-input); border: 1px solid var(--border-color);
  padding: 10px 12px; border-radius: var(--radius-sm); display: flex; align-items: center; gap: 10px;
  transition: border-color 0.3s var(--ease-out), box-shadow 0.3s var(--ease-out);
}
.status-card.is-loading { border-color: var(--gold-dim); }
.status-card.is-error { border-color: var(--ember); box-shadow: 0 0 8px rgba(212,90,74,0.15); }
.status-card.is-syncing { border-color: var(--gold); animation: borderPulse 2s infinite; }

.pulse-light { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; transition: background 0.3s ease; }
.pulse-light.success { background: var(--verdant); }
.pulse-light.warning { background: var(--gold); animation: pulse 1s infinite; }
.pulse-light.danger { background: var(--ember); }
.pulse-light.syncing { background: var(--gold-light); animation: pulse 0.6s infinite; }

.status-text { font-size: 0.76rem; font-weight: 500; }
.error-details { color: var(--ember); font-size: 0.68rem; margin: 6px 0 0 0; }
.cache-path { color: var(--text-dim); font-size: 0.6rem; margin: 6px 0 0 0; word-break: break-all; }

/* ── Main workspace ── */
.main-workspace {
  display: flex; flex-direction: column; height: 100vh;
  background: var(--bg-deepest);
  position: relative;
}
.main-workspace::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0; opacity: 0.025;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='52'%3E%3Cpath d='M30 0L60 15v22L30 52 0 37V15z' fill='none' stroke='%23c9a84c' stroke-width='0.5'/%3E%3C/svg%3E");
  background-size: 60px 52px;
}

.workspace-header {
  background: var(--bg-glass, rgba(26,23,18,0.85));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(201,168,76,0.12);
  padding: 8px 24px; display: flex; justify-content: space-between; align-items: center;
  font-size: 0.7rem; position: relative; z-index: 2;
}
.header-left { display: flex; align-items: center; gap: 10px; }
.hdr-icon { color: #c9a84c; font-size: 0.8rem; opacity: 0.3; }
.breadcrumb { color: var(--gold-dim, #8a7030); font-weight: 500; font-family: 'Cinzel', serif; letter-spacing: 2px; }
.header-right { display: flex; align-items: center; gap: 8px; }
.hdr-dot { width: 6px; height: 6px; border-radius: 50%; background: #5aae6f; box-shadow: 0 0 6px rgba(90,174,111,0.4); }
.timestamp { color: var(--text-dim, #706858); }

.data-view-panel {
  flex: 1; padding: 18px; overflow-y: auto; position: relative; z-index: 1;
}
.dashboard-welcome { height: 100%; display: flex; align-items: center; justify-content: center; }
.welcome-terminal {
  background: var(--bg-glass);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--border-gold);
  padding: 36px; border-radius: var(--radius-lg);
  width: 85%; max-width: 560px;
  box-shadow: var(--shadow-elevated);
}
.console-line {
  color: var(--verdant); margin: 6px 0; font-size: 0.82rem;
  animation: typeIn 0.5s var(--ease-out) both;
}
.console-line:nth-child(2) { animation-delay: 0.3s; }

/* ── Animations ── */
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
@keyframes borderPulse { 0%, 100% { border-color: var(--gold); } 50% { border-color: var(--border-gold-solid); } }
@keyframes typeIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
@keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
@keyframes scaleIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }

/* ── Vue Transition: view mode switch ── */
.view-fade-enter-active { transition: all 0.3s var(--ease-out); }
.view-fade-leave-active { transition: all 0.2s ease-in; }
.view-fade-enter-from { opacity: 0; transform: translateY(8px); }
.view-fade-leave-to { opacity: 0; transform: translateY(-4px); }

/* ── Vue Transition: panel slide ── */
.panel-slide-enter-active { transition: all 0.35s var(--ease-out); }
.panel-slide-leave-active { transition: all 0.2s ease-in; }
.panel-slide-enter-from { opacity: 0; transform: translateX(30px); }
.panel-slide-leave-to { opacity: 0; transform: translateX(-10px); }

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-gold-solid); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--gold-dim); }

/* ── Collapsible log float ── */
.log-float {
  position: fixed; bottom: 12px; left: 12px; z-index: 300;
  font-family: 'JetBrains Mono', monospace; font-size: 0.6rem;
  max-width: 420px;
}
.log-toggle {
  display: flex; align-items: center; gap: 8px;
  background: rgba(10,9,6,0.9); backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.08); border-radius: 20px;
  padding: 5px 12px; cursor: pointer;
  color: #807860; font-family: 'JetBrains Mono', monospace; font-size: 0.6rem;
  transition: all 0.2s ease;
}
.log-toggle:hover { border-color: rgba(255,255,255,0.15); }
.log-dot { width: 7px; height: 7px; border-radius: 50%; background: #807860; flex-shrink: 0; }
.log-dot-ok { background: #5aae6f; }
.log-dot-fail { background: #d45a4a; }
.log-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 280px; }
.log-chevron { font-size: 0.4rem; transition: transform 0.2s ease; }
.log-chevron.open { transform: rotate(90deg); }

.log-body {
  margin-top: 6px;
  background: rgba(10,9,6,0.92); backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
  padding: 8px 12px; max-height: 200px; overflow-y: auto;
}
.log-empty { color: #5a5245; padding: 4px 0; }
.log-line { display: flex; gap: 8px; padding: 2px 0; color: #807860; }
.log-line.log-ok { color: #5aae6f; }
.log-line.log-fail { color: #d45a4a; }
.log-time { opacity: 0.5; white-space: nowrap; flex-shrink: 0; }
.log-msg { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
