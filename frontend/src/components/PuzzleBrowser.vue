<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import type { UniversalSuggestion } from "../api/omApi";
import { t } from "../utils/i18n";

const emit = defineEmits<{ select: [puzzle: UniversalSuggestion] }>();

type ChapterData = Record<string, { id: string; displayName: string; controller: string }[]>;
const chapters = ref<ChapterData>({});
const expanded = ref<Record<string, boolean>>({});
const filter = ref("");
const open = ref(false);

onMounted(async () => {
  try {
    const res = await fetch("/api/puzzles");
    if (res.ok) chapters.value = await res.json();
  } catch { /* silently fail */ }
});

const filteredChapters = computed(() => {
  const q = filter.value.toLowerCase().trim();
  if (!q) return chapters.value;
  const result: ChapterData = {};
  for (const [ch, puzzles] of Object.entries(chapters.value)) {
    const matched = puzzles.filter(p =>
      p.displayName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    );
    if (matched.length > 0) result[ch] = matched;
  }
  return result;
});

function total() {
  return Object.values(chapters.value).reduce((s, p) => s + p.length, 0);
}
function toggleChapter(ch: string) {
  expanded.value[ch] = !expanded.value[ch];
}
function onSelect(p: { id: string; displayName: string; controller: string }) {
  emit("select", p as UniversalSuggestion);
}
</script>

<template>
  <div class="pb-root">
    <button class="pb-toggle" @click="open = !open">
      <span class="pb-arrow" :class="{ open }">▶</span>
      <span class="pb-label">{{ total() }} PUZZLES</span>
    </button>

    <div v-if="open" class="pb-body">
      <input v-model="filter" class="pb-filter" :placeholder="t('pb_filter')" />
      <div class="pb-chapters">
        <div v-for="(puzzles, chapter) in filteredChapters" :key="chapter" class="pb-chapter">
          <button class="pb-chapter-btn" @click="toggleChapter(chapter)">
            <span class="pb-ch-arrow" :class="{ open: expanded[chapter] }">▶</span>
            <span class="pb-ch-name">{{ chapter }}</span>
            <span class="pb-ch-count">{{ puzzles.length }}</span>
          </button>
          <div v-if="expanded[chapter]" class="pb-ch-items">
            <button
              v-for="p in puzzles" :key="p.id"
              class="pb-item" @click="onSelect(p)" :title="p.displayName"
            >
              <span class="pb-name">{{ p.displayName }}</span>
              <span class="pb-id">#{{ p.id }}</span>
            </button>
          </div>
        </div>
      </div>
      <div v-if="Object.keys(filteredChapters).length === 0" class="pb-empty">{{ t('pb_no_match') }}</div>
    </div>
  </div>
</template>

<style scoped>
.pb-root { display: flex; flex-direction: column; }
.pb-toggle {
  display: flex; align-items: center; gap: 6px;
  background: none; border: 1px solid rgba(255,255,255,0.06);
  color: #807860; padding: 6px 10px; border-radius: 6px;
  font-family: 'Cinzel', serif; font-size: 0.6rem;
  cursor: pointer; letter-spacing: 1px; width: 100%;
  transition: all 0.15s ease;
}
.pb-toggle:hover { border-color: rgba(201,168,76,0.2); color: #c9a84c; }
.pb-arrow { font-size: 0.45rem; transition: transform 0.2s ease; display: inline-block; }
.pb-arrow.open { transform: rotate(90deg); }
.pb-label { flex: 1; text-align: left; }

.pb-body { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; max-height: 340px; }
.pb-filter {
  background: rgba(0,0,0,0.25); color: #e0d8c8;
  border: 1px solid rgba(255,255,255,0.08); padding: 5px 8px;
  border-radius: 6px; font-family: 'JetBrains Mono', monospace;
  font-size: 0.6rem; outline: none; flex-shrink: 0;
  transition: border-color 0.2s;
}
.pb-filter:focus { border-color: #c9a84c; }
.pb-filter::placeholder { color: #706858; }

.pb-chapters { overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 2px; }

.pb-chapter-btn {
  display: flex; align-items: center; gap: 6px;
  background: none; border: none; color: #c9a84c;
  padding: 5px 4px; font-family: 'Cinzel', serif;
  font-size: 0.58rem; cursor: pointer; letter-spacing: 1px;
  width: 100%; text-align: left;
  transition: color 0.15s;
}
.pb-chapter-btn:hover { color: #e2c96e; }
.pb-ch-arrow { font-size: 0.4rem; transition: transform 0.2s ease; }
.pb-ch-arrow.open { transform: rotate(90deg); }
.pb-ch-name { flex: 1; }
.pb-ch-count { color: #706858; font-size: 0.52rem; font-family: 'JetBrains Mono', monospace; }

.pb-ch-items { padding-left: 10px; display: flex; flex-direction: column; gap: 1px; }

.pb-item {
  display: flex; align-items: center; gap: 6px;
  background: none; border: 1px solid transparent;
  color: #a09888; padding: 4px 6px; border-radius: 4px;
  font-family: 'JetBrains Mono', monospace; font-size: 0.58rem;
  cursor: pointer; text-align: left; width: 100%;
  transition: all 0.15s ease;
}
.pb-item:hover {
  background: rgba(201,168,76,0.06); color: #e0d8c8;
  border-color: rgba(201,168,76,0.15);
}
.pb-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-id { color: #706858; font-size: 0.52rem; }
.pb-empty { color: #706858; font-size: 0.55rem; text-align: center; padding: 8px; }
</style>
