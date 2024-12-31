package com.foodrecord.core.optimization;

public class ExecutionTimePoint {
    private final long timestamp;
    private final long duration;

    public ExecutionTimePoint(long timestamp, long duration) {
        this.timestamp = timestamp;
        this.duration = duration;
    }

    public long getTimestamp() {
        return timestamp;
    }

    public long getDuration() {
        return duration;
    }
} 