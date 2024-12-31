package com.foodrecord.core.logging;

public class PerformanceAnomaly {
    private final String type;
    private final String endpoint;
    private final double actualValue;
    private final double thresholdValue;
    private final Severity severity;

    public PerformanceAnomaly(String type, String endpoint, double actualValue, 
                             double thresholdValue, Severity severity) {
        this.type = type;
        this.endpoint = endpoint;
        this.actualValue = actualValue;
        this.thresholdValue = thresholdValue;
        this.severity = severity;
    }

    public String getType() {
        return type;
    }

    public String getEndpoint() {
        return endpoint;
    }

    public double getActualValue() {
        return actualValue;
    }

    public double getThresholdValue() {
        return thresholdValue;
    }

    public Severity getSeverity() {
        return severity;
    }

    public double getDeviationRatio() {
        return actualValue / thresholdValue;
    }

    @Override
    public String toString() {
        return String.format("%s anomaly detected for endpoint '%s': actual=%.2f, threshold=%.2f, severity=%s",
            type, endpoint, actualValue, thresholdValue, severity);
    }
} 