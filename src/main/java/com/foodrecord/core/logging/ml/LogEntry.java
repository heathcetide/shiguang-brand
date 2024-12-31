package com.foodrecord.core.logging.ml;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.HashMap;

public class LogEntry {
    private String logLevel;
    private String message;
    private LocalDateTime timestamp;
    private String source;
    private Map<String, String> metadata;

    public LogEntry(String logLevel, String message, LocalDateTime timestamp, String source) {
        this.logLevel = logLevel;
        this.message = message;
        this.timestamp = timestamp;
        this.source = source;
        this.metadata = new HashMap<>();
    }

    public String getLogLevel() {
        return logLevel;
    }

    public String getMessage() {
        return message;
    }

    public LocalDateTime getTimestamp() {
        return timestamp;
    }

    public String getSource() {
        return source;
    }

    public Map<String, String> getMetadata() {
        return metadata;
    }

    public void addMetadata(String key, String value) {
        metadata.put(key, value);
    }
} 