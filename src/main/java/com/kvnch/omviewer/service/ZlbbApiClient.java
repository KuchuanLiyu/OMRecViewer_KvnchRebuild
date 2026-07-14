package com.kvnch.omviewer.service;

import com.kvnch.omviewer.model.OmPuzzleDTO;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

@Service
public class ZlbbApiClient {
    private static final Logger log = LoggerFactory.getLogger(ZlbbApiClient.class);

    private final RestTemplate restTemplate;
    private final String baseUrl;

    public ZlbbApiClient(RestTemplate restTemplate,
                         @Value("${app.zlbb-base-url}") String baseUrl) {
        this.restTemplate = restTemplate;
        this.baseUrl = baseUrl;
    }

    /**
     * Fetch records for a specific puzzle from ZLBB API.
     * Returns the raw JSON string on success, or null on failure.
     */
    public String fetchRecords(String controller, String puzzleId) {
        String encoded = URLEncoder.encode(puzzleId, StandardCharsets.UTF_8);
        String url = baseUrl + "/" + controller + "/puzzle/" + encoded + "/records?includeFrontier=true";

        for (int attempt = 1; attempt <= 2; attempt++) {
            try {
                log.debug("[API_FETCH]: {} (attempt {})", url, attempt);
                ResponseEntity<String> response = restTemplate.getForEntity(url, String.class);

                if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                    int len = response.getBody().length();
                    log.debug("[API_DOWNLOAD]: Received {} bytes", len);
                    return response.getBody();
                } else {
                    log.warn("[API_ERROR]: HTTP {}", response.getStatusCode().value());
                    return null;
                }
            } catch (RestClientException e) {
                log.warn("[API_ERROR]: Connection failed: {}", e.getMessage());
                if (attempt < 2) log.debug("[API_RETRY]: Retrying...");
            }
        }
        return null;
    }

    /**
     * Fetch the puzzle list for a given controller (e.g. "om", "exa").
     * Returns the parsed list, or null on failure.
     */
    public OmPuzzleDTO[] fetchPuzzles(String controller) {
        String url = baseUrl + "/" + controller + "/puzzles";
        try {
            log.debug("[BOOT_SYNC]: Fetching {}/puzzles ...", controller);
            ResponseEntity<OmPuzzleDTO[]> response =
                    restTemplate.getForEntity(url, OmPuzzleDTO[].class);
            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                log.debug("[BOOT_SYNC]: {} puzzles loaded ({} entries)", controller, response.getBody().length);
                return response.getBody();
            }
        } catch (RestClientException e) {
            log.warn("[BOOT_ERROR]: Failed to fetch /{}/puzzles: {}", controller, e.getMessage());
        }
        return null;
    }
}
