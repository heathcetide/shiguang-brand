package com.foodrecord.core.flow.analytics;

import java.time.LocalDateTime;

public class TrendPoint {
    private LocalDateTime timestamp;
    private double value;

    public TrendPoint(LocalDateTime timestamp, double value) {
        this.timestamp = timestamp;
        this.value = value;
    }

    public LocalDateTime getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(LocalDateTime timestamp) {
        this.timestamp = timestamp;
    }

    public double getValue() {
        return value;
    }

    public void setValue(double value) {
        this.value = value;
    }
} 