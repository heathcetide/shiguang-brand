package com.foodrecord.core.logging;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.HashMap;

public class LogEvent {
    private String level;
    private String message;
    private String source;
    private LocalDateTime timestamp;
    private String threadName;
    private Map<String, String> metadata;
    private String stackTrace;

    public LogEvent() {
        this.metadata = new HashMap<>();
        this.timestamp = LocalDateTime.now();
    }

    public LogEvent(String level, String message, String source) {
        this();
        this.level = level;
        this.message = message;
        this.source = source;
    }

    public String getLevel() {
        return level;
    }

    public void setLevel(String level) {
        this.level = level;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public LocalDateTime getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(LocalDateTime timestamp) {
        this.timestamp = timestamp;
    }

    public String getThreadName() {
        return threadName;
    }

    public void setThreadName(String threadName) {
        this.threadName = threadName;
    }

    public Map<String, String> getMetadata() {
        return metadata;
    }

    public void setMetadata(Map<String, String> metadata) {
        this.metadata = metadata;
    }

    public void addMetadata(String key, String value) {
        this.metadata.put(key, value);
    }

    public String getStackTrace() {
        return stackTrace;
    }

    public void setStackTrace(String stackTrace) {
        this.stackTrace = stackTrace;
    }
} 