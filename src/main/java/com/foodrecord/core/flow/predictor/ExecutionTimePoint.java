package com.foodrecord.core.flow.predictor;

import java.time.LocalDateTime;

public class ExecutionTimePoint {
    private LocalDateTime timestamp;
    private double duration;

    public ExecutionTimePoint(LocalDateTime timestamp, double duration) {
        this.timestamp = timestamp;
        this.duration = duration;
    }

    public LocalDateTime getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(LocalDateTime timestamp) {
        this.timestamp = timestamp;
    }

    public double getDuration() {
        return duration;
    }

    public void setDuration(double duration) {
        this.duration = duration;
    }
} 