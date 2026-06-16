package com.kvnch.omviewer.controller;

import com.kvnch.omviewer.service.PuzzleService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class DiagnosticsController {

    private final PuzzleService puzzleService;

    public DiagnosticsController(PuzzleService puzzleService) {
        this.puzzleService = puzzleService;
    }

    @GetMapping("/boot/ready")
    public ResponseEntity<Boolean> bootReady() {
        return ResponseEntity.ok(puzzleService.isBootReady());
    }

    @GetMapping("/cache/path")
    public ResponseEntity<String> cachePath() {
        return ResponseEntity.ok(puzzleService.getCachePath());
    }

    @GetMapping("/cache/info")
    public ResponseEntity<String> cacheInfo() {
        return ResponseEntity.ok(puzzleService.getCacheInfo());
    }
}
