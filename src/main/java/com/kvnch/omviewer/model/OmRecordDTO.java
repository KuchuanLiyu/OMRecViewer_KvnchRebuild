package com.kvnch.omviewer.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public class OmRecordDTO {
    private String id;
    private OmPuzzleDTO puzzle;
    private OmScoreDTO score;
    private String smartFormattedScore;
    private String fullFormattedScore;
    private List<String> categoryIds;
    private String author;
    private String gif;
    private String solution;
    private String lastModified;

    public OmRecordDTO() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public OmPuzzleDTO getPuzzle() { return puzzle; }
    public void setPuzzle(OmPuzzleDTO puzzle) { this.puzzle = puzzle; }
    public OmScoreDTO getScore() { return score; }
    public void setScore(OmScoreDTO score) { this.score = score; }
    public String getSmartFormattedScore() { return smartFormattedScore; }
    public void setSmartFormattedScore(String s) { this.smartFormattedScore = s; }
    public String getFullFormattedScore() { return fullFormattedScore; }
    public void setFullFormattedScore(String s) { this.fullFormattedScore = s; }
    public List<String> getCategoryIds() { return categoryIds; }
    public void setCategoryIds(List<String> c) { this.categoryIds = c; }
    public String getAuthor() { return author; }
    public void setAuthor(String a) { this.author = a; }
    public String getGif() { return gif; }
    public void setGif(String g) { this.gif = g; }
    public String getSolution() { return solution; }
    public void setSolution(String s) { this.solution = s; }
    public String getLastModified() { return lastModified; }
    public void setLastModified(String lm) { this.lastModified = lm; }
}
