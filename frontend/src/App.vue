<script setup lang="ts">
import { ref, watch } from "vue";
import OmList from "./components/OmList.vue";
import type { OmRecordDTO } from "./types/om";
import type { UniversalSuggestion } from "./api/omApi";
import { searchOmRecords, getLivePuzzleSuggestions, checkBootReady, getCachePath, getCacheInfo } from "./api/omApi";
import { t, locale, type Locale } from "./utils/i18n";
watch(locale, (v) => { document.documentElement.lang = v; }, { immediate: true });

const searchKeyword = ref<string>("");
const suggestions = ref<UniversalSuggestion[]>([]);
const showSuggestions = ref<boolean>(false);

const currentRecords = ref<OmRecordDTO[]>([]);
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
        <div class="logo-icon"><img src="/icon.png" alt="Opus Magnum" class="logo-img" /></div>
        <div class="brand-text">
          <h2>{{ t('brand_title') }}</h2>
          <span>{{ t('brand_sub') }}</span>
        </div>
      </div>
      <hr class="divider" />
      <div class="lang-switch">
        <label class="section-label">{{ t('lang_label') }}</label>
        <select v-model="locale" class="lang-select">
          <option value="en">English</option>
          <option value="zh">中文</option>
          <option value="ja">日本語</option>
        </select>
      </div>
      <div class="control-group">
        <label class="section-label">{{ t('section_query') }}</label>
        <div class="search-field-wrapper">
          <div class="input-container">
            <input
              type="text"
              v-model="searchKeyword"
              :placeholder="t('placeholder_search')"
              @keyup.enter="handleEnterKey"
              @focus="showSuggestions = true"
              @blur="closeSuggestions"
              :disabled="loading"
              class="cyber-input"
            />
            <ul v-if="showSuggestions && suggestions.length > 0" class="suggestions-menu">
              <li v-for="s in suggestions" :key="s.id" @mousedown="selectSuggestion(s)" class="suggestion-item">
                <span class="s-name">{{ s.displayName }}</span>
                <span class="s-id">[{{ s.controller.toUpperCase() }}] #{{ s.id }}</span>
              </li>
            </ul>
          </div>
          <button @click="handleEnterKey" :disabled="loading || !searchKeyword.trim()" class="btn-execute">{{ t('btn_execute') }}</button>
          <button @click="forceRefresh = !forceRefresh; if (forceRefresh) executeRefresh()" class="btn-execute" style="margin-top:6px" :class="{ active: forceRefresh }">{{ t('btn_refresh') }}</button>
        </div>
      </div>
      <div class="status-zone">
        <label class="section-label">{{ t('section_diag') }}</label>
        <div class="status-card" :class="{ 'is-loading': loading, 'is-error': errorMessage, 'is-syncing': !bootReady }">
          <div :class="['pulse-light', loading ? 'warning' : !bootReady ? 'syncing' : errorMessage ? 'danger' : 'success']"></div>
          <span class="status-text">{{ !bootReady ? t('status_syncing') : loading ? t('status_fetching') : errorMessage ? t('status_error') : t('status_ready') }}</span>
        </div>
        <p v-if="errorMessage" class="error-details">> {{ errorMessage }}</p>
        <p class="cache-path">{{ t('cache_label') }} {{ cachePath }}</p>
        <p class="cache-path">{{ cacheInfo }}</p>
      </div>
    </aside>
    <main class="main-workspace">
      <header class="workspace-header">
        <div class="breadcrumb">{{ t('breadcrumb') }}</div>
        <div class="timestamp">{{ t('sys_online') }}</div>
      </header>
      <section class="data-view-panel">
        <div v-if="!hasSearched" class="dashboard-welcome">
          <div class="welcome-terminal">
            <p class="console-line">{{ t('welcome_line1') }}</p>
            <p class="console-line">{{ t('welcome_line2') }}</p>
          </div>
        </div>
        <OmList v-else :records="currentRecords" />
      </section>
    </main>
  </div>
</template>

<style>
/* ── Opus Magnum Alchemical Theme ── */
:root {
  --bg-deepest:       #0c0a06;
  --bg-deep:          #100e0a;
  --bg-panel:         #181510;
  --bg-input:         #1f1b14;
  --bg-hover:         #282318;
  --border-color:     #332d22;
  --border-gold:      #5a4a2a;
  --gold:             #c9a84c;
  --gold-light:       #d4c078;
  --gold-dim:         #8a7030;
  --copper:           #b87333;
  --text:             #e0d8c8;
  --text-muted:       #9a9078;
  --text-dim:         #7a7060;
  --ember:            #c44b3c;
  --verdant:          #5a9e6f;
  --parchment:        #d4c8a8;
}

body {
  margin: 0; padding: 0;
  background-color: var(--bg-deepest);
  color: var(--text);
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  line-height: 1.5;
  overflow: hidden;
}
/* Chinese: use calligraphic font for headings, Song for body */
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
  font-family: 'Ma Shan Zheng', 'Noto Serif SC', serif !important;
  font-size: 115%;
}
:lang(zh) .ap-legend,
:lang(zh) .ap-meta,
:lang(zh) .ap-sub,
:lang(zh) .ap-list-hint,
:lang(zh) .ap-help-box,
:lang(zh) .ap-pca-note,
:lang(zh) .ellipsoid-desc-inline,
:lang(zh) .three-axes-legend,
:lang(zh) .ap-card-score,
:lang(zh) .ap-dim-chip,
:lang(zh) .leg-item,
:lang(zh) .hint,
:lang(zh) .improve-sub,
:lang(zh) .legend-box,
:lang(zh) .status-text,
:lang(zh) .error-details {
  font-size: 110%;
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
  font-family: 'Noto Serif SC', serif !important;
}

.app-container {
  display: grid;
  grid-template-columns: 340px 1fr;
  height: 100vh; width: 100vw;
}

/* ── Sidebar ── */
.sidebar-panel {
  background: var(--bg-panel);
  border-right: 1px solid var(--border-gold);
  padding: 24px 20px;
  display: flex; flex-direction: column; gap: 20px;
  box-shadow: inset -1px 0 0 rgba(201,168,76,0.05), 4px 0 24px rgba(0,0,0,0.4);
  backdrop-filter: blur(4px);
}

.brand-zone { display: flex; align-items: center; gap: 12px; }
.logo-icon {
  width: 36px; height: 36px;
  filter: drop-shadow(0 0 8px rgba(201,168,76,0.3));
}
.logo-img { width: 100%; height: 100%; object-fit: contain; }
.brand-text h2 {
  margin: 0; font-size: 1rem; font-weight: 700;
  font-family: 'Cinzel', serif;
  color: var(--gold-light);
  letter-spacing: 2px;
}
.brand-text span {
  font-size: 0.6rem; font-weight: 600;
  font-family: 'Cinzel', serif;
  color: var(--gold-dim);
  letter-spacing: 3px;
  text-transform: uppercase;
}

.divider { border: 0; height: 1px; background: var(--border-gold); margin: 0; opacity: 0.4; }

.lang-switch { margin-bottom: 4px; }
.lang-select {
  width: 100%; background: var(--bg-input); color: var(--text-muted);
  border: 1px solid var(--border-color); padding: 6px 8px; border-radius: 2px;
  font-family: 'JetBrains Mono', monospace; font-size: 0.68rem; outline: none;
  cursor: pointer; transition: border-color 200ms ease;
}
.lang-select:focus { border-color: var(--gold); }

.section-label {
  display: block; font-size: 0.62rem; font-weight: 600;
  font-family: 'Cinzel', serif;
  color: var(--gold-dim);
  letter-spacing: 2px;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.search-field-wrapper { display: flex; flex-direction: column; gap: 10px; }
.input-container { position: relative; width: 100%; }

.cyber-input {
  width: 100%; background: var(--bg-input);
  border: 1px solid var(--border-color);
  color: var(--text); padding: 10px 12px;
  border-radius: 2px; box-sizing: border-box;
  font-size: 0.82rem; font-family: 'JetBrains Mono', monospace;
  outline: none;
  transition: border-color 200ms ease;
}
.cyber-input:focus { border-color: var(--gold); outline: 1px solid var(--gold); outline-offset: 0; }
.cyber-input::placeholder { color: var(--text-dim); }
.cyber-input:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }

/* Global: use ease-out for entering, ease-in for exiting per UX Pro Max */
* { transition-timing-function: ease-out; }

.suggestions-menu {
  position: absolute; top: calc(100% + 4px); left: 0; width: 100%;
  background: var(--bg-panel); border: 1px solid var(--border-gold);
  border-radius: 2px; padding: 0; margin: 0; list-style: none;
  z-index: 999; max-height: 200px; overflow-y: auto;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
}
.suggestion-item {
  padding: 9px 12px; cursor: pointer; display: flex;
  justify-content: space-between; align-items: center;
  font-size: 0.78rem; border-bottom: 1px solid var(--border-color);
  transition: background 150ms ease;
}
.suggestion-item:hover { background: var(--bg-hover); }
.s-name { color: var(--text); }
.s-id { color: var(--gold-dim); font-size: 0.68rem; }

.btn-execute {
  background: var(--border-gold); color: var(--gold-light);
  border: 1px solid var(--gold-dim); padding: 10px; min-height: 44px;
  border-radius: 2px; font-weight: 700; cursor: pointer;
  font-family: 'Cinzel', serif; font-size: 0.72rem;
  letter-spacing: 2px;
  transition: background 200ms ease-out, color 200ms ease-out;
}
.btn-execute:hover { background: var(--gold-dim); color: var(--bg-deepest); }
.btn-execute.active { background: var(--copper); border-color: var(--copper); color: #fff; }
.btn-execute:disabled { opacity: 0.3; cursor: not-allowed; }
.btn-execute:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }

/* ── Status ── */
.status-card {
  background: var(--bg-input); border: 1px solid var(--border-color);
  padding: 12px; border-radius: 2px; display: flex; align-items: center; gap: 12px;
  transition: border-color 300ms ease;
}
.status-card.is-loading { border-color: var(--gold-dim); }
.status-card.is-error { border-color: var(--ember); }
.status-card.is-syncing { border-color: var(--gold); }

.pulse-light { width: 8px; height: 8px; border-radius: 50%; transition: background 300ms ease; }
.pulse-light.success { background: var(--verdant); }
.pulse-light.warning { background: var(--gold); animation: pulse 1s infinite; }
.pulse-light.danger { background: var(--ember); }
.pulse-light.syncing { background: var(--gold-light); animation: pulse 0.6s infinite; }

.status-text { font-size: 0.78rem; font-weight: 500; }
.error-details { color: var(--ember); font-size: 0.7rem; margin: 6px 0 0 0; }
.cache-path { color: var(--text-dim); font-size: 0.62rem; margin: 6px 0 0 0; word-break: break-all; }

/* ── Main workspace ── */
.main-workspace {
  display: flex; flex-direction: column; height: 100vh;
  background: var(--bg-deepest);
  position: relative;
}
/* subtle hex pattern overlay */
.main-workspace::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0; opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='52'%3E%3Cpath d='M30 0L60 15v22L30 52 0 37V15z' fill='none' stroke='%23c9a84c' stroke-width='0.5'/%3E%3C/svg%3E");
  background-size: 60px 52px;
}

.workspace-header {
  background: var(--bg-panel); border-bottom: 1px solid var(--border-gold);
  padding: 12px 24px; display: flex; justify-content: space-between; align-items: center;
  font-size: 0.72rem; position: relative; z-index: 1;
}
.breadcrumb { color: var(--gold-dim); font-weight: 500; font-family: 'Cinzel', serif; letter-spacing: 2px; }
.timestamp { color: var(--text-dim); }

.data-view-panel {
  flex: 1; padding: 20px; overflow-y: auto; position: relative; z-index: 1;
}
.dashboard-welcome { height: 100%; display: flex; align-items: center; justify-content: center; }
.welcome-terminal {
  background: var(--bg-panel); border: 1px solid var(--border-gold);
  padding: 32px; border-radius: 2px; width: 85%; max-width: 560px;
  box-shadow: 0 0 40px rgba(201,168,76,0.04);
}
.console-line { color: var(--verdant); margin: 6px 0; font-size: 0.82rem; }

@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
</style>
