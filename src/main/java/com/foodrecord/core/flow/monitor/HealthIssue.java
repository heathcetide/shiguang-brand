package com.foodrecord.core.flow.monitor;

import java.time.LocalDateTime;
import java.util.Map;

public class HealthIssue {
    private final String issueId;
    private final Severity severity;
    private final String description;
    private final String component;
    private final LocalDateTime detectionTime;
    private final Map<String, Object> context;

    public HealthIssue(String issueId, Severity severity, String description,
                      String component, LocalDateTime detectionTime,
                      Map<String, Object> context) {
        this.issueId = issueId;
        this.severity = severity;
        this.description = description;
        this.component = component;
        this.detectionTime = detectionTime;
        this.context = context;
    }

    public String getIssueId() {
        return issueId;
    }

    public Severity getSeverity() {
        return severity;
    }

    public String getDescription() {
        return description;
    }

    public String getComponent() {
        return component;
    }

    public LocalDateTime getDetectionTime() {
        return detectionTime;
    }

    public Map<String, Object> getContext() {
        return context;
    }
}
