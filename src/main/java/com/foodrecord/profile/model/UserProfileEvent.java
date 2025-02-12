package com.foodrecord.profile.model;

import java.util.Map;

public class UserProfileEvent {
    private String eventType;
    private Map<String, Object> properties;
    private long timestamp;

    public UserProfileEvent(String eventType, Map<String, Object> properties) {
        this.eventType = eventType;
        this.properties = properties;
        this.timestamp = System.currentTimeMillis();
    }

    // Getters and setters
    public String getEventType() {
        return eventType;
    }

    public void setEventType(String eventType) {
        this.eventType = eventType;
    }

    public Map<String, Object> getProperties() {
        return properties;
    }

    public void setProperties(Map<String, Object> properties) {
        this.properties = properties;
    }

    public long getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(long timestamp) {
        this.timestamp = timestamp;
    }
} 