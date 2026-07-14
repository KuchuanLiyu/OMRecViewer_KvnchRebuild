package com.kvnch.omviewer.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class UniversalSuggestion {
    private String id;
    private String displayName;
    private String controller;

    public UniversalSuggestion() {}

    public UniversalSuggestion(String id, String displayName, String controller) {
        this.id = id;
        this.displayName = displayName;
        this.controller = controller;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getDisplayName() { return displayName; }
    public void setDisplayName(String d) { this.displayName = d; }
    public String getController() { return controller; }
    public void setController(String c) { this.controller = c; }
}
