package com.foodrecord.recommend.model;

import java.util.Map;

public class RecommendDTO {
    private Long itemId;
    private String itemType;
    private Double score;
    private String reason;
    private Map<String, Object> features;
    
    // getters and setters
    public RecommendDTO() {

    }

    public RecommendDTO(Long itemId, String itemType, Double score, String reason, Map<String, Object> features) {
        this.itemId = itemId;
        this.itemType = itemType;
        this.score = score;
        this.reason = reason;
    }

    public RecommendDTO(Long itemId, Double score){
        this.itemId = itemId;
        this.score = score;
    }

    public Long getItemId() {
        return itemId;
    }

    public void setItemId(Long itemId) {
        this.itemId = itemId;
    }

    public String getItemType() {
        return itemType;
    }

    public void setItemType(String itemType) {
        this.itemType = itemType;
    }

    public Double getScore() {
        return score;
    }

    public void setScore(Double score) {
        this.score = score;
    }

    public String getReason() {
        return reason;
    }

    public void setReason(String reason) {
        this.reason = reason;
    }

    public Map<String, Object> getFeatures() {
        return features;
    }

    public void setFeatures(Map<String, Object> features) {
        this.features = features;
    }
}