package com.kvnch.omviewer.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kvnch.omviewer.model.OmRecordDTO;
import com.kvnch.omviewer.model.UniversalSuggestion;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;

@Service
public class CacheFileService {
    private static final Logger log = LoggerFactory.getLogger(CacheFileService.class);
    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss 'UTC'")
            .withZone(ZoneId.of("UTC"));

    private final ObjectMapper objectMapper;
    private final Path cacheDir;

    public CacheFileService(ObjectMapper objectMapper,
                            @Value("${app.cache-dir:./cache}") String cacheDirPath) {
        this.objectMapper = objectMapper;
        this.cacheDir = Path.of(cacheDirPath);
        try {
            Files.createDirectories(this.cacheDir);
        } catch (IOException e) {
            log.warn("Cannot create cache dir: {}", e.getMessage());
        }
    }

    public String getCacheDirPath() {
        return cacheDir.toAbsolutePath().toString();
    }

    // ---- Record cache (per puzzle) ----

    public List<OmRecordDTO> loadRecordCache(String controller, String puzzleId) {
        Path file = cacheDir.resolve(controller + "_" + puzzleId + ".cache.json");
        if (!Files.exists(file)) return null;
        try {
            String json = Files.readString(file);
            @SuppressWarnings("unchecked")
            List<OmRecordDTO> records = objectMapper.readValue(json,
                    objectMapper.getTypeFactory().constructCollectionType(List.class, OmRecordDTO.class));
            log.debug("[CACHE_HIT]: Loaded {} bytes from disk for {}/{}", json.length(), controller, puzzleId);
            return records;
        } catch (IOException e) {
            log.warn("[CACHE_ERROR]: {}", e.getMessage());
            return null;
        }
    }

    public void saveRecordCache(String controller, String puzzleId, String rawJson) {
        Path file = cacheDir.resolve(controller + "_" + puzzleId + ".cache.json");
        try {
            Files.writeString(file, rawJson);
            log.debug("[CACHE_WRITE]: Saved {} bytes to disk", rawJson.length());
            saveCacheMeta();
        } catch (IOException e) {
            log.warn("[CACHE_WRITE_ERROR]: {}", e.getMessage());
        }
    }

    // ---- Puzzle list cache ----

    public List<UniversalSuggestion> loadPuzzleList() {
        Path file = cacheDir.resolve("puzzles.cache.json");
        if (!Files.exists(file)) return null;
        try {
            String json = Files.readString(file);
            @SuppressWarnings("unchecked")
            List<UniversalSuggestion> list = objectMapper.readValue(json,
                    objectMapper.getTypeFactory().constructCollectionType(List.class, UniversalSuggestion.class));
            log.debug("[BOOT_CACHE]: Loaded {} puzzles from disk", list.size());
            return list;
        } catch (IOException e) {
            log.warn("[PUZZLE_CACHE_ERROR]: {}", e.getMessage());
            return null;
        }
    }

    public void savePuzzleList(List<UniversalSuggestion> list) {
        Path file = cacheDir.resolve("puzzles.cache.json");
        try {
            String json = objectMapper.writeValueAsString(list);
            Files.writeString(file, json);
            log.debug("[CACHE_SAVED]: Puzzle list cached ({} entries)", list.size());
            saveCacheMeta();
        } catch (IOException e) {
            log.warn("[PUZZLE_CACHE_WRITE_ERROR]: {}", e.getMessage());
        }
    }

    // ---- Metadata ----

    public String getCacheInfo() {
        Path file = cacheDir.resolve("cache_meta.json");
        if (Files.exists(file)) {
            try {
                String json = Files.readString(file);
                var node = objectMapper.readTree(json);
                String updated = node.has("updated") ? node.get("updated").asText() : "unknown";
                return "Local: " + updated;
            } catch (IOException ignored) {}
        }
        String now = utcNow();
        saveCacheMeta();
        return "Local: " + now + " (new)";
    }

    void saveCacheMeta() {
        Path file = cacheDir.resolve("cache_meta.json");
        try {
            String json = "{\"updated\":\"" + utcNow() + "\"}";
            Files.writeString(file, json);
        } catch (IOException ignored) {}
    }

    private String utcNow() {
        return FMT.format(Instant.now());
    }
}
