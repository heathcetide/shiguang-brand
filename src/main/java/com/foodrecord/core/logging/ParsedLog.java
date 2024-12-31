package com.foodrecord.core.logging;

import com.foodrecord.core.logging.ml.FeatureVector;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class ParsedLog {
    private final String logId;
    private final LocalDateTime timestamp;
    private final LogLevel level;
    private final String message;
    private final String source;
    private final Map<String, String> metadata;
    private final PerformanceData performanceData;

    public ParsedLog(String logId, LocalDateTime timestamp, LogLevel level,
                    String message, String source, Map<String, String> metadata,
                    PerformanceData performanceData) {
        this.logId = logId;
        this.timestamp = timestamp;
        this.level = level;
        this.message = message;
        this.source = source;
        this.metadata = metadata;
        this.performanceData = performanceData;
    }

    public String getLogId() {
        return logId;
    }

    public LocalDateTime getTimestamp() {
        return timestamp;
    }

    public LogLevel getLevel() {
        return level;
    }

    public String getMessage() {
        return message;
    }

    public String getSource() {
        return source;
    }

    public Map<String, String> getMetadata() {
        return metadata;
    }

    public PerformanceData getPerformanceData() {
        return performanceData;
    }

    public enum LogLevel {
        TRACE,
        DEBUG,
        INFO,
        WARN,
        ERROR,
        FATAL
    }

    public static class PerformanceData {
        private final long executionTime;
        private final long memoryUsage;
        private final int threadCount;
        private final Map<String, Double> metrics;

        public PerformanceData(long executionTime, long memoryUsage,
                             int threadCount, Map<String, Double> metrics) {
            this.executionTime = executionTime;
            this.memoryUsage = memoryUsage;
            this.threadCount = threadCount;
            this.metrics = metrics;
        }

        public long getExecutionTime() {
            return executionTime;
        }

        public long getMemoryUsage() {
            return memoryUsage;
        }

        public int getThreadCount() {
            return threadCount;
        }

        public Map<String, Double> getMetrics() {
            return metrics;
        }
    }

    String extractStackTrace(ParsedLog logEntry) {
        String message = logEntry.getMessage();
        if (message.contains("Exception")) {
            return message.substring(message.indexOf("Exception"));
        }
        return null;
    }

    public FeatureVector toFeatureVector(ParsedLog logEntry) {
        List<Double> features = new ArrayList<>();
        features.add((double) logEntry.getPerformanceData().getExecutionTime());
        features.add((double) logEntry.getPerformanceData().getMemoryUsage());
        features.add((double) logEntry.getPerformanceData().getThreadCount());
        FeatureVector featureVector = new FeatureVector();
        return featureVector;
    }

} 