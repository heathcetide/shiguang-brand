package com.foodrecord.core.flow.analytics;

public class Anomaly {
    private String executionId;
    private String type;
    private String description;

    public Anomaly(String executionId, String type, String description) {
        this.executionId = executionId;
        this.type = type;
        this.description = description;
    }

    public String getExecutionId() {
        return executionId;
    }

    public void setExecutionId(String executionId) {
        this.executionId = executionId;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }
} 