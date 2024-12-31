package com.foodrecord.core.logging;

import java.util.List;

public class PerformanceReport {
    private final PerformanceMetrics metrics;
    private final List<PerformanceAnomaly> anomalies;

    public PerformanceReport(PerformanceMetrics metrics, List<PerformanceAnomaly> anomalies) {
        this.metrics = metrics;
        this.anomalies = anomalies;
    }

    public PerformanceMetrics getMetrics() {
        return metrics;
    }

    public List<PerformanceAnomaly> getAnomalies() {
        return anomalies;
    }

    public boolean hasSignificantIssues() {
        return metrics.hasSignificantIssues() || 
               anomalies.stream().anyMatch(a -> a.getSeverity().isHigherThan(Severity.MEDIUM));
    }

    public double getAverageResponseTimes() {
        return metrics.getAverageResponseTimes().values().stream()
                .mapToDouble(Double::doubleValue)
                .average()
                .orElse(0.0);
    }
} 