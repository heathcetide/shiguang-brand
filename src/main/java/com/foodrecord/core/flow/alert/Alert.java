package com.foodrecord.core.flow.alert;

import com.foodrecord.core.logging.Severity;
import java.time.LocalDateTime;
import java.util.Map;

public class Alert {
    private final String id;
    private final Type type;
    private final String message;
    private final Severity severity;
    private final long timestamp;
    private final Map<String, Object> details;

    public Alert(Type type, String message, Severity severity, long timestamp, Map<String, Object> details) {
        this.timestamp = timestamp;
        this.id = generateId();
        this.type = type;
        this.message = message;
        this.severity = severity;
        this.details = details;
    }

    private String generateId() {
        return String.format("ALERT-%d", System.currentTimeMillis());
    }

    public String getId() {
        return id;
    }

    public Type getType() {
        return type;
    }

    public String getMessage() {
        return message;
    }

    public Severity getSeverity() {
        return severity;
    }

    public long getTimestamp() {
        return timestamp;
    }

    public Map<String, Object> getDetails() {
        return details;
    }

    public enum Type {
        ERROR,
        PERFORMANCE,
        SECURITY,
        SYSTEM
    }
}