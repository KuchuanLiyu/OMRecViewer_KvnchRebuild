package com.kvnch.omviewer.service;

import com.kvnch.omviewer.model.OmPuzzleDTO;
import com.kvnch.omviewer.model.UniversalSuggestion;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;

@Service
public class BootSequenceService implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(BootSequenceService.class);

    private final PuzzleService puzzleService;
    private final CacheFileService cacheFileService;
    private final ZlbbApiClient apiClient;

    public BootSequenceService(PuzzleService puzzleService,
                               CacheFileService cacheFileService,
                               ZlbbApiClient apiClient) {
        this.puzzleService = puzzleService;
        this.cacheFileService = cacheFileService;
        this.apiClient = apiClient;
    }

    @Override
    public void run(ApplicationArguments args) {
        log.info("[BOOT]: Cache directory: {}", cacheFileService.getCacheDirPath());

        // Step 1: Load from disk cache immediately
        List<UniversalSuggestion> cached = cacheFileService.loadPuzzleList();
        if (cached != null && !cached.isEmpty()) {
            puzzleService.updatePuzzleList(cached);
            puzzleService.setBootReady(true);
            log.info("[BOOT_READY]: App ready (cached). {} puzzles loaded.", cached.size());
        }

        // Step 2: Background sync from API
        CompletableFuture.runAsync(() -> {
            List<UniversalSuggestion> aggregated = new ArrayList<>();

            // Fetch OM puzzles
            OmPuzzleDTO[] omPuzzles = apiClient.fetchPuzzles("om");
            if (omPuzzles != null) {
                for (OmPuzzleDTO p : omPuzzles) {
                    aggregated.add(new UniversalSuggestion(p.getId(), p.getDisplayName(), "om"));
                }
            }

            // Fetch EXA puzzles
            OmPuzzleDTO[] exaPuzzles = apiClient.fetchPuzzles("exa");
            if (exaPuzzles != null) {
                for (OmPuzzleDTO p : exaPuzzles) {
                    aggregated.add(new UniversalSuggestion(p.getId(), p.getDisplayName(), "exa"));
                }
            }

            // Fallback to disk cache if API failed and we have nothing
            if (aggregated.isEmpty()) {
                List<UniversalSuggestion> diskFallback = cacheFileService.loadPuzzleList();
                if (diskFallback != null) {
                    aggregated = diskFallback;
                    log.info("[CACHE_HIT]: Puzzle list loaded from disk ({} entries)", aggregated.size());
                }
            } else {
                // Save to disk
                cacheFileService.savePuzzleList(aggregated);
            }

            // Update in-memory state
            puzzleService.updatePuzzleList(aggregated);
            puzzleService.setBootReady(true);
            log.info("[BOOT_SYNC]: Global maps initialized ({} puzzles).", aggregated.size());
        });
    }
}
