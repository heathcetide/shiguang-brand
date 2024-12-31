package com.foodrecord.core.logging;

import java.util.List;
import java.util.Map;

public class ErrorImpactAnalysis {
    private final Severity severity;
    private final List<String> affectedServices;
    private final Map<String, Integer> errorDistribution;
    private final Map<String, Double> serviceHealthMetrics;
    private final List<String> potentialCauses;

    public ErrorImpactAnalysis(
        Severity severity,
        List<String> affectedServices,
        Map<String, Integer> errorDistribution,
        Map<String, Double> serviceHealthMetrics,
        List<String> potentialCauses
    ) {
        this.severity = severity;
        this.affectedServices = affectedServices;
        this.errorDistribution = errorDistribution;
        this.serviceHealthMetrics = serviceHealthMetrics;
        this.potentialCauses = potentialCauses;
    }

    public Severity getSeverity() {
        return severity;
    }

    public List<String> getAffectedServices() {
        return affectedServices;
    }

    public Map<String, Integer> getErrorDistribution() {
        return errorDistribution;
    }

    public Map<String, Double> getServiceHealthMetrics() {
        return serviceHealthMetrics;
    }

    public List<String> getPotentialCauses() {
        return potentialCauses;
    }

    public boolean isSystemWide() {
        return affectedServices.size() > 3;
    }

    public boolean isCritical() {
        return severity == Severity.CRITICAL;
    }

    public double getOverallImpactScore() {
        return (severity.getLevel() * affectedServices.size() * 
                errorDistribution.values().stream().mapToInt(Integer::intValue).sum()) / 100.0;
    }
} 