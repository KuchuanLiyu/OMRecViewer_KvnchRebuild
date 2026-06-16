package com.kvnch.omviewer.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public class OmScoreDTO {
    private int cost;
    private int cycles;
    private int area;
    private int instructions;
    private boolean overlap;
    private boolean trackless;
    private Integer height;
    private Double width;

    @JsonProperty("boundingHex")
    private Integer boundingHex;

    private Double rate;

    public OmScoreDTO() {}

    public int getCost() { return cost; }
    public void setCost(int cost) { this.cost = cost; }
    public int getCycles() { return cycles; }
    public void setCycles(int cycles) { this.cycles = cycles; }
    public int getArea() { return area; }
    public void setArea(int area) { this.area = area; }
    public int getInstructions() { return instructions; }
    public void setInstructions(int instructions) { this.instructions = instructions; }
    public boolean isOverlap() { return overlap; }
    public void setOverlap(boolean overlap) { this.overlap = overlap; }
    public boolean isTrackless() { return trackless; }
    public void setTrackless(boolean trackless) { this.trackless = trackless; }
    public Integer getHeight() { return height; }
    public void setHeight(Integer height) { this.height = height; }
    public Double getWidth() { return width; }
    public void setWidth(Double width) { this.width = width; }
    public Integer getBoundingHex() { return boundingHex; }
    public void setBoundingHex(Integer boundingHex) { this.boundingHex = boundingHex; }
    public Double getRate() { return rate; }
    public void setRate(Double rate) { this.rate = rate; }
}
