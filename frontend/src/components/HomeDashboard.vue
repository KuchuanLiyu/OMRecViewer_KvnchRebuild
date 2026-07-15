<script setup lang="ts">
import { ref, onMounted } from "vue";
import { t } from "../utils/i18n";

const emit = defineEmits<{ search: [id: string] }>();

interface RecentEntry { id: string; name: string; time: number }
const recent = ref<RecentEntry[]>([]);
const puzzleCount = ref(0);

// Time-greetings — Alchemical Academy Research Terminal
const hourGreets = [
  "The terminal glows in the darkness…",
  "Dawn — the archives never sleep.",
  "Good morning, Researcher.",
  "The Academy halls are alive with discovery.",
  "Afternoon analysis session.",
  "The crucible burns brightest at dusk.",
  "Evening — time to review the records.",
  "Late night at the research terminal.",
];
const greet = ref("");

onMounted(async () => {
  try {
    const raw = localStorage.getItem("recentPuzzles");
    if (raw) recent.value = JSON.parse(raw);
  } catch { /* ignore */ }
  try {
    const res = await fetch("/api/puzzles");
    if (res.ok) {
      const data = await res.json();
      puzzleCount.value = Array.isArray(data) ? data.length : Object.values(data).flat().length;
    }
  } catch { /* ignore */ }
  greet.value = hourGreets[Math.floor(new Date().getHours() / 3)] ?? hourGreets[0];
});

function addRecent(id: string, name: string) {
  const list = recent.value.filter(r => r.id !== id);
  list.unshift({ id, name, time: Date.now() });
  if (list.length > 8) list.pop();
  recent.value = list;
  localStorage.setItem("recentPuzzles", JSON.stringify(list));
}

defineExpose({ addRecent });
</script>

<template>
  <div class="dash-root">
    <!-- Hero -->
    <div class="dash-hero">
      <div class="hero-seal">
        <span class="seal-ring">⬡</span>
        <span class="seal-inner">⚗</span>
      </div>
      <h1 class="hero-title">ALCHEMICAL ACADEMY</h1>
      <p class="hero-subtitle">Research Terminal · Solution Archives</p>
      <p class="hero-greet">{{ greet }}</p>
      <div class="hero-stats">
        <span class="stat">{{ puzzleCount }} <em>reagents</em></span>
        <span class="stat-sep">·</span>
        <span class="stat">{{ recent.length }} <em>in memory</em></span>
      </div>
    </div>

    <!-- Recent formulae -->
    <div v-if="recent.length > 0" class="dash-section">
      <h3 class="dash-heading">⏱ {{ t('dash_recent') }}</h3>
      <div class="dash-recent-grid">
        <button
          v-for="r in recent" :key="r.id"
          class="dash-recent-card" @click="emit('search', r.id)"
        >
          <span class="rc-hex">⬡</span>
          <span class="rc-name">{{ r.name }}</span>
          <span class="rc-id">#{{ r.id }}</span>
        </button>
      </div>
    </div>

    <!-- Operating the Engine -->
    <div class="dash-section">
      <h3 class="dash-heading">{{ t('dash_quick') }}</h3>
      <div class="recipe-cards">
        <div class="recipe-step">
          <div class="rs-num">Ⅰ</div>
          <p>{{ t('dash_step1') }}</p>
        </div>
        <div class="recipe-connector">→</div>
        <div class="recipe-step">
          <div class="rs-num">Ⅱ</div>
          <p>{{ t('dash_step2') }}</p>
        </div>
        <div class="recipe-connector">→</div>
        <div class="recipe-step">
          <div class="rs-num">Ⅲ</div>
          <p>{{ t('dash_step3') }}</p>
        </div>
        <div class="recipe-connector">→</div>
        <div class="recipe-step">
          <div class="rs-num">Ⅳ</div>
          <p>{{ t('dash_step4') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dash-root { max-width: 760px; margin: 0 auto; padding: 36px 20px; }

/* ── Hero ── */
.dash-hero { text-align: center; margin-bottom: 40px; }
.hero-seal {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 52px; height: 52px; margin-bottom: 14px;
}
.seal-ring {
  position: absolute; color: #c9a84c; font-size: 2.2rem; opacity: 0.3;
  animation: sealSpin 20s linear infinite;
}
.seal-inner {
  font-family: 'Cinzel', serif; color: #e2c96e;
  font-size: 1.1rem; font-weight: 700; z-index: 1;
}
@keyframes sealSpin { to { transform: rotate(360deg); } }

.hero-title {
  font-family: 'Cinzel', serif; color: var(--gold-light, #e2c96e);
  font-size: 1.3rem; font-weight: 700; letter-spacing: 5px;
  margin: 0 0 6px;
}
.hero-subtitle {
  font-family: 'Cinzel', serif; color: #5a4a2a;
  font-size: 0.58rem; letter-spacing: 3px; text-transform: uppercase;
  margin: 0 0 14px;
}
.hero-greet {
  color: #8a7a60; font-size: 0.68rem; margin: 0 0 16px;
  font-style: italic;
}
.hero-stats {
  display: flex; justify-content: center; gap: 10px;
  font-family: 'JetBrains Mono', monospace; font-size: 0.62rem;
}
.stat { color: #807860; }
.stat em { color: #c9a84c; font-style: normal; font-weight: 600; }
.stat-sep { color: #5a5245; }

/* ── Sections ── */
.dash-section { margin-bottom: 34px; }
.dash-heading {
  font-family: 'Cinzel', serif; color: #c9a84c;
  font-size: 0.68rem; letter-spacing: 2px; margin: 0 0 14px;
}

/* ── Recent cards ── */
.dash-recent-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.dash-recent-card {
  background: rgba(26,23,18,0.5); border: 1px solid rgba(255,255,255,0.05);
  border-radius: 10px; padding: 16px 12px; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  text-align: center; color: inherit; font-family: inherit;
}
.dash-recent-card:hover {
  background: rgba(201,168,76,0.05); border-color: rgba(201,168,76,0.25);
  transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
.rc-hex { color: #8a7030; font-size: 1rem; opacity: 0.25; transition: opacity 0.25s; }
.dash-recent-card:hover .rc-hex { opacity: 0.7; }
.rc-name { color: #e0d8c8; font-size: 0.66rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.rc-id { color: #706858; font-size: 0.56rem; }

/* ── Recipe steps ── */
.recipe-cards {
  display: flex; align-items: flex-start; gap: 0;
  background: rgba(26,23,18,0.4); border: 1px solid rgba(255,255,255,0.05);
  border-radius: 12px; padding: 24px 16px; overflow-x: auto;
}
.recipe-step { flex: 1; min-width: 110px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; }
.rs-num {
  font-family: 'Cinzel', serif; color: #c9a84c; font-size: 1.2rem; font-weight: 700;
  width: 40px; height: 40px; border-radius: 50%;
  background: rgba(201,168,76,0.08); border: 1px solid rgba(201,168,76,0.2);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.recipe-step p { color: #a09888; font-size: 0.6rem; line-height: 1.5; margin: 0; }
.recipe-connector { color: #5a5245; font-size: 0.7rem; padding-top: 12px; flex-shrink: 0; }
</style>
