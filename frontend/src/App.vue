<script setup lang="ts">
import { ref, watch } from "vue";
import OmList from "./components/OmList.vue";
import type { OmRecordDTO } from "./types/om";
import type { UniversalSuggestion } from "./api/omApi";
import { searchOmRecords, getLivePuzzleSuggestions, checkBootReady, getCachePath, getCacheInfo } from "./api/omApi";
import { t, locale, type Locale } from "./utils/i18n";
import { logBus } from "./utils/logBus";
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

      <!-- Debug log panel (bottom-left) -->
      <div v-if="logBus.length > 0" class="log-panel">
        <div v-for="(entry, i) in logBus.slice(-8)" :key="i" class="log-line"
          :class="{ 'log-ok': entry.ok === true, 'log-fail': entry.ok === false }">
          <span class="log-time">{{ entry.time }}</span>
          <span class="log-msg">{{ entry.msg }}</span>
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
  font-size: 14px;
  line-height: 1.5;
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
.logo-icon {
  width: 38px; height: 38px;
  filter: drop-shadow(0 0 10px rgba(201,168,76,0.35));
  transition: filter 0.3s var(--ease-out);
}
.logo-icon:hover { filter: drop-shadow(0 0 16px rgba(201,168,76,0.55)); }
.logo-img { width: 100%; height: 100%; object-fit: contain; }
.brand-text h2 {
  margin: 0; font-size: 0.95rem; font-weight: 700;
  font-family: 'Cinzel', serif;
  color: var(--gold-light);
  letter-spacing: 2px;
  transition: color 0.3s var(--ease-out);
}
.brand-text span {
  font-size: 0.58rem; font-weight: 600;
  font-family: 'Cinzel', serif;
  color: var(--gold-dim);
  letter-spacing: 3px;
  text-transform: uppercase;
}

.divider { border: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--border-gold-solid), transparent); margin: 0; opacity: 0.5; }

.lang-switch { margin-bottom: 2px; }
.lang-select {
  width: 100%; background: var(--bg-input); color: var(--text-muted);
  border: 1px solid var(--border-color); padding: 7px 10px; border-radius: var(--radius-sm);
  font-family: 'JetBrains Mono', monospace; font-size: 0.68rem; outline: none;
  cursor: pointer;
  transition: border-color 0.25s var(--ease-out), box-shadow 0.25s var(--ease-out);
}
.lang-select:focus {
  border-color: var(--gold);
  box-shadow: 0 0 0 2px rgba(201,168,76,0.15);
}

.section-label {
  display: block; font-size: 0.6rem; font-weight: 600;
  font-family: 'Cinzel', serif;
  color: var(--gold-dim);
  letter-spacing: 2px;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.search-field-wrapper { display: flex; flex-direction: column; gap: 8px; }
.input-container { position: relative; width: 100%; }

.cyber-input {
  width: 100%; background: var(--bg-input);
  border: 1px solid var(--border-color);
  color: var(--text); padding: 10px 12px;
  border-radius: var(--radius-sm); box-sizing: border-box;
  font-size: 0.8rem; font-family: 'JetBrains Mono', monospace;
  outline: none;
  transition: border-color 0.25s var(--ease-out), box-shadow 0.25s var(--ease-out);
}
.cyber-input:focus {
  border-color: var(--gold);
  box-shadow: 0 0 0 2px rgba(201,168,76,0.12);
}
.cyber-input::placeholder { color: var(--text-dim); }

.suggestions-menu {
  position: absolute; top: calc(100% + 4px); left: 0; width: 100%;
  background: var(--bg-panel); border: 1px solid var(--border-gold);
  border-radius: var(--radius-sm); padding: 0; margin: 0; list-style: none;
  z-index: 999; max-height: 200px; overflow-y: auto;
  box-shadow: var(--shadow-elevated);
  backdrop-filter: blur(8px);
}
.suggestion-item {
  padding: 9px 12px; cursor: pointer; display: flex;
  justify-content: space-between; align-items: center;
  font-size: 0.76rem; border-bottom: 1px solid var(--border-subtle);
  transition: background 0.15s var(--ease-out);
}
.suggestion-item:last-child { border-bottom: none; }
.suggestion-item:hover { background: var(--bg-hover); }
.s-name { color: var(--text); }
.s-id { color: var(--gold-dim); font-size: 0.64rem; }

.btn-execute {
  background: var(--border-gold-solid); color: var(--gold-light);
  border: 1px solid var(--gold-dim); padding: 10px; min-height: 42px;
  border-radius: var(--radius-sm); font-weight: 700; cursor: pointer;
  font-family: 'Cinzel', serif; font-size: 0.7rem;
  letter-spacing: 2px;
  transition: all 0.25s var(--ease-out);
  position: relative; overflow: hidden;
}
.btn-execute::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.08) 50%, transparent 60%);
  transform: translateX(-100%);
  transition: transform 0.4s var(--ease-out);
}
.btn-execute:hover::after { transform: translateX(100%); }
.btn-execute:hover { background: var(--gold-dim); color: var(--bg-deepest); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(201,168,76,0.2); }
.btn-execute:active { transform: translateY(0); }
.btn-execute.active { background: var(--copper); border-color: var(--copper); color: #fff; }
.btn-execute:disabled { opacity: 0.3; cursor: not-allowed; transform: none; }

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
  background: var(--bg-glass);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-gold);
  padding: 10px 24px; display: flex; justify-content: space-between; align-items: center;
  font-size: 0.7rem; position: relative; z-index: 2;
}
.breadcrumb { color: var(--gold-dim); font-weight: 500; font-family: 'Cinzel', serif; letter-spacing: 2px; }
.timestamp { color: var(--text-dim); }

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

/* ── Debug log panel ── */
.log-panel {
  position: fixed; bottom: 12px; left: 12px; z-index: 300;
  background: rgba(10,9,6,0.9); backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;
  padding: 8px 12px; max-width: 500px;
  font-family: 'JetBrains Mono', monospace; font-size: 0.62rem;
  pointer-events: none;
}
.log-line { display: flex; gap: 8px; padding: 2px 0; color: #807860; }
.log-line.log-ok { color: #5aae6f; }
.log-line.log-fail { color: #d45a4a; }
.log-time { opacity: 0.5; white-space: nowrap; }
.log-msg { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
