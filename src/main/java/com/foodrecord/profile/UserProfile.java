package com.foodrecord.profile;

import java.util.List;
import java.util.Map;
import java.util.Set;

public class UserProfile {
    private Long userId;
    private Map<String, Object> basicFeatures;
    private Map<String, Object> behaviorFeatures;
    private Set<String> interestTags;
    private List<String> segments;

    // Getters and setters
    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public Map<String, Object> getBasicFeatures() {
        return basicFeatures;
    }

    public void setBasicFeatures(Map<String, Object> basicFeatures) {
        this.basicFeatures = basicFeatures;
    }

    public Map<String, Object> getBehaviorFeatures() {
        return behaviorFeatures;
    }

    public void setBehaviorFeatures(Map<String, Object> behaviorFeatures) {
        this.behaviorFeatures = behaviorFeatures;
    }

    public Set<String> getInterestTags() {
        return interestTags;
    }

    public void setInterestTags(Set<String> interestTags) {
        this.interestTags = interestTags;
    }

    public List<String> getSegments() {
        return segments;
    }

    public void setSegments(List<String> segments) {
        this.segments = segments;
    }
} 