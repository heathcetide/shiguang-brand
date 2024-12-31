package com.foodrecord.core.logging;

public class AnomalyScore {
    private final double value;
    private final String type;
    private final String description;

    public AnomalyScore(double value, String type, String description) {
        this.value = value;
        this.type = type;
        this.description = description;
    }

    public double getValue() {
        return value;
    }

    public String getType() {
        return type;
    }

    public String getDescription() {
        return description;
    }

    public boolean isAnomaly() {
        return value > 0.7; // 阈值可以根据需要调整
    }
} 