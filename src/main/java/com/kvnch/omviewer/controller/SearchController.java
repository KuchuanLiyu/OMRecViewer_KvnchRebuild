package com.kvnch.omviewer.controller;

import com.kvnch.omviewer.model.OmRecordDTO;
import com.kvnch.omviewer.model.UniversalSuggestion;
import com.kvnch.omviewer.service.PuzzleService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api")
public class SearchController {

    private final PuzzleService puzzleService;

    public SearchController(PuzzleService puzzleService) {
        this.puzzleService = puzzleService;
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

    @GetMapping("/suggestions")
    public ResponseEntity<List<UniversalSuggestion>> suggestions(@RequestParam String keyword) {
        if (keyword.trim().isEmpty()) {
            return ResponseEntity.ok(List.of());
        }
        return ResponseEntity.ok(puzzleService.getSuggestions(keyword));
    }
}
