package com.kvnch.omviewer.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.kvnch.omviewer.model.OmRecordDTO;
import com.kvnch.omviewer.model.UniversalSuggestion;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.Collectors;

@Service
public class PuzzleService {
    private static final Logger log = LoggerFactory.getLogger(PuzzleService.class);

    private final ZlbbApiClient apiClient;
    private final CacheFileService cacheFileService;
    private final ObjectMapper objectMapper;

    // ── State ──
    private final Map<String, List<OmRecordDTO>> recordVault = new ConcurrentHashMap<>();
    private final List<UniversalSuggestion> puzzleList = new CopyOnWriteArrayList<>();
    private final Set<String> inFlightPuzzles = ConcurrentHashMap.newKeySet();
    private volatile boolean bootReady = false;

    public PuzzleService(ZlbbApiClient apiClient, CacheFileService cacheFileService,
                         ObjectMapper objectMapper) {
        this.apiClient = apiClient;
        this.cacheFileService = cacheFileService;
        this.objectMapper = objectMapper;
    }

    // ── Boot ready ──

    public boolean isBootReady() { return bootReady; }
    public void setBootReady(boolean ready) { this.bootReady = ready; }

    // ── Puzzle list management ──

    public List<UniversalSuggestion> getPuzzleList() { return puzzleList; }

    public void updatePuzzleList(List<UniversalSuggestion> list) {
        puzzleList.clear();
        puzzleList.addAll(list);
    }

    // ── Suggestions ──

    public List<UniversalSuggestion> getSuggestions(String keyword) {
        String fragment = keyword.trim().toLowerCase();
        if (fragment.isEmpty()) return Collections.emptyList();

        return puzzleList.stream()
                .filter(p -> p.getId().toLowerCase().contains(fragment)
                        || p.getDisplayName().toLowerCase().contains(fragment))
                .collect(Collectors.toList());
    }

    // ── Resolve keyword → (controller, puzzleId) ──

    private String[] resolveKeyword(String keyword) {
        String query = keyword.trim().toLowerCase();
        // Exact match first, then contains match
        UniversalSuggestion match = puzzleList.stream()
                .filter(p -> p.getId().toLowerCase().equals(query)
                        || p.getDisplayName().toLowerCase().equals(query))
                .findFirst()
                .orElseGet(() -> puzzleList.stream()
                        .filter(p -> p.getId().toLowerCase().contains(query)
                                || p.getDisplayName().toLowerCase().contains(query))
                        .findFirst()
                        .orElse(null));

        String controller = match != null ? match.getController() : "om";
        String puzzleId = match != null ? match.getId() : keyword.trim();
        return new String[]{controller, puzzleId};
    }

    // ── Search (3-tier cache) ──

    public List<OmRecordDTO> search(String keyword, boolean force) {
        String[] resolved = resolveKeyword(keyword);
        String controller = resolved[0];
        String puzzleId = resolved[1];

        log.debug("[SEARCH]: controller={}, puzzleId={}, force={}", controller, puzzleId, force);

        // Tier 1: Memory vault (non-force)
        if (!force) {
            List<OmRecordDTO> cached = recordVault.get(puzzleId);
            if (cached != null && !cached.isEmpty()) {
                log.debug("[VAULT_HIT]: Returning {} cached records for '{}'", cached.size(), puzzleId);
                return cached;
            }
        }

        // Flight lock
        if (!inFlightPuzzles.add(puzzleId)) {
            log.debug("[CONCURRENCY_INTERCEPT]: Already fetching '{}', returning cached if any", puzzleId);
            return recordVault.getOrDefault(puzzleId, Collections.emptyList());
        }

        try {
            // Tier 2: Disk cache (non-force)
            if (!force) {
                List<OmRecordDTO> disk = cacheFileService.loadRecordCache(controller, puzzleId);
                if (disk != null && !disk.isEmpty()) {
                    mergeIntoVault(puzzleId, disk);
                    return recordVault.getOrDefault(puzzleId, Collections.emptyList());
                }
            }

            // Tier 3: ZLBB API
            String rawJson = apiClient.fetchRecords(controller, puzzleId);
            if (rawJson != null) {
                try {
                    OmRecordDTO[] records = objectMapper.readValue(rawJson, OmRecordDTO[].class);
                    log.debug("[ZLBB_PARSER]: {} records from API", records.length);

                    // Save raw JSON to disk cache
                    cacheFileService.saveRecordCache(controller, puzzleId, rawJson);

                    // Merge into memory vault
                    mergeIntoVault(puzzleId, Arrays.asList(records));
                } catch (JsonProcessingException e) {
                    String preview = rawJson.length() > 300 ? rawJson.substring(0, 300) : rawJson;
                    log.error("[ZLBB_ERROR]: JSON parse failed: {}. Body: {}...", e.getMessage(), preview);
                }
            }
        } finally {
            inFlightPuzzles.remove(puzzleId);
        }

        return recordVault.getOrDefault(puzzleId, Collections.emptyList());
    }

    // ── Dedup merge ──

    private void mergeIntoVault(String puzzleId, List<OmRecordDTO> incoming) {
        List<OmRecordDTO> existing = recordVault.computeIfAbsent(puzzleId, k -> new ArrayList<>());

        synchronized (existing) {
            for (OmRecordDTO remote : incoming) {
                boolean duplicate = existing.stream().anyMatch(local ->
                        Objects.equals(local.getPuzzle().getId(), remote.getPuzzle().getId())
                                && Objects.equals(local.getFullFormattedScore(), remote.getFullFormattedScore()));
                if (!duplicate) {
                    existing.add(remote);
                }
            }
        }
        log.debug("[VAULT]: {} total records for puzzle '{}'", existing.size(), puzzleId);
    }

    // ── Diagnostics ──

    public String getCachePath() {
        return cacheFileService.getCacheDirPath();
    }

    public String getCacheInfo() {
        return cacheFileService.getCacheInfo();
    }
}
