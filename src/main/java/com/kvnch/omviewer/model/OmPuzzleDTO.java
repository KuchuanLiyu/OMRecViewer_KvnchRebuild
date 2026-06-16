package com.kvnch.omviewer.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.ArrayList;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public class OmPuzzleDTO {
    private String id;
    private String displayName;
    private String type;
    private OmGroupDTO group;
    private List<String> altIds = new ArrayList<>();

    public OmPuzzleDTO() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getDisplayName() { return displayName; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public OmGroupDTO getGroup() { return group; }
    public void setGroup(OmGroupDTO group) { this.group = group; }
    public List<String> getAltIds() { return altIds; }
    public void setAltIds(List<String> altIds) { this.altIds = altIds; }
}
