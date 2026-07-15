package com.kvnch.omviewer.controller;

import com.kvnch.omviewer.model.OmRecordDTO;
import com.kvnch.omviewer.model.UniversalSuggestion;
import com.kvnch.omviewer.service.PuzzleService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.stream.Stream;

@RestController
@RequestMapping("/api")
public class SearchController {

    private static final Logger log = LoggerFactory.getLogger(SearchController.class);
    private static final Path LOG_FILE = Paths.get("./replay-proxy.log");

    private final PuzzleService puzzleService;
    private final Path puzzleDir;
    private final com.kvnch.omviewer.service.ZlbbApiClient apiClient;

    public SearchController(PuzzleService puzzleService,
                            @Value("${app.puzzle-dir:./puzzles}") String puzzleDirPath,
                            com.kvnch.omviewer.service.ZlbbApiClient apiClient) {
        this.puzzleService = puzzleService;
        this.puzzleDir = Paths.get(puzzleDirPath);
        this.apiClient = apiClient;
    }

    private void flog(String msg) {
        String line = LocalDateTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss")) + " " + msg;
        log.info(msg);
        try { Files.writeString(LOG_FILE, line + "\n", java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND); }
        catch (IOException ignored) {}
    }

    @GetMapping("/search")
    public ResponseEntity<List<OmRecordDTO>> search(
            @RequestParam String keyword,
            @RequestParam(defaultValue = "false") boolean force) {
        if (keyword.trim().isEmpty()) {
            return ResponseEntity.ok(List.of());
        }
        try {
            List<OmRecordDTO> results = puzzleService.search(keyword, force);
            return ResponseEntity.ok(results);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    /** Return puzzles grouped by chapter (fetches from ZLBB puzzle API). */
    @GetMapping("/puzzles")
    public ResponseEntity<java.util.Map<String, java.util.List<java.util.Map<String, String>>>> listPuzzles() {
        java.util.Map<String, java.util.List<java.util.Map<String, String>>> grouped = new java.util.LinkedHashMap<>();
        for (String ctrl : new String[]{"om", "exa"}) {
            var arr = apiClient.fetchPuzzles(ctrl);
            if (arr == null) continue;
            for (var p : arr) {
                String chapter = (p.getGroup() != null) ? p.getGroup().getDisplayName() : "Other";
                var m = new java.util.HashMap<String, String>();
                m.put("id", p.getId());
                m.put("displayName", p.getDisplayName());
                m.put("controller", ctrl);
                grouped.computeIfAbsent(chapter, k -> new java.util.ArrayList<>()).add(m);
            }
        }
        return ResponseEntity.ok(grouped);
    }

    @GetMapping("/suggestions")
    public ResponseEntity<List<UniversalSuggestion>> suggestions(@RequestParam String keyword) {
        if (keyword.trim().isEmpty()) {
            return ResponseEntity.ok(List.of());
        }
        return ResponseEntity.ok(puzzleService.getSuggestions(keyword));
    }

    /** Serve .puzzle binary file for omclone replay. */
    @GetMapping("/puzzle-file/{name}")
    public ResponseEntity<byte[]> getPuzzleFile(@PathVariable String name) {
        try {
            // 1. Exact match
            Path exact = puzzleDir.resolve(name + ".puzzle");
            if (Files.exists(exact)) {
                return ResponseEntity.ok()
                        .contentType(MediaType.APPLICATION_OCTET_STREAM)
                        .body(Files.readAllBytes(exact));
            }

            // 2. Recursive fuzzy match scan (max depth 5)
            String lower = name.toLowerCase().replaceAll("[^a-z0-9]", "");
            try (Stream<Path> stream = Files.find(puzzleDir, 5,
                    (p, a) -> p.getFileName().toString().endsWith(".puzzle"))) {
                Path found = stream
                        .filter(p -> {
                            String fn = p.getFileName().toString().toLowerCase().replaceAll("[^a-z0-9]", "");
                            return fn.contains(lower) || lower.contains(fn);
                        })
                        .findFirst()
                        .orElse(null);
                if (found != null) {
                    return ResponseEntity.ok()
                            .contentType(MediaType.APPLICATION_OCTET_STREAM)
                            .body(Files.readAllBytes(found));
                }
            }

            return ResponseEntity.notFound().build();
        } catch (IOException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /** Proxy solution download: ZLBB → (301) → GitHub Raw → binary bytes. */
    @GetMapping("/proxy")
    public ResponseEntity<byte[]> proxySolution(@RequestParam String url) {
        flog("PROXY: " + url);
        try {
            java.net.http.HttpClient client = java.net.http.HttpClient.newBuilder()
                    .followRedirects(java.net.http.HttpClient.Redirect.NORMAL).build();
            java.net.http.HttpRequest req = java.net.http.HttpRequest.newBuilder(
                    java.net.URI.create(url))
                    .timeout(java.time.Duration.ofSeconds(15))
                    .header("User-Agent", "KvnchRebuild/0.1")
                    .build();
            byte[] data = client.send(req, java.net.http.HttpResponse.BodyHandlers.ofByteArray()).body();
            flog("PROXY OK: " + data.length + " bytes");
            return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM).body(data);
        } catch (Exception e) {
            flog("PROXY FAIL: " + e.getClass().getSimpleName() + " - " + e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).build();
        }
    }
}
