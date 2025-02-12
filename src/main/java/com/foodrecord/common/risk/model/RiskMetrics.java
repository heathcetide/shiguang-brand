package com.foodrecord.common.risk.model;

import java.util.Map;

public class RiskMetrics {
    private long totalEvents;
    private Map<String, Long> eventCounts;
    private Map<String, Double> riskScores;
    private double avgRiskScore;
    private long highRiskCount;
    private long mediumRiskCount;
    private long lowRiskCount;

    // Getters and setters
    public long getTotalEvents() {
        return totalEvents;
    }

    public void setTotalEvents(long totalEvents) {
        this.totalEvents = totalEvents;
    }

    public Map<String, Long> getEventCounts() {
        return eventCounts;
    }

    public void setEventCounts(Map<String, Long> eventCounts) {
        this.eventCounts = eventCounts;
    }

    public Map<String, Double> getRiskScores() {
        return riskScores;
    }

    public void setRiskScores(Map<String, Double> riskScores) {
        this.riskScores = riskScores;
    }

    public double getAvgRiskScore() {
        return avgRiskScore;
    }

    public void setAvgRiskScore(double avgRiskScore) {
        this.avgRiskScore = avgRiskScore;
    }

    public long getHighRiskCount() {
        return highRiskCount;
    }

    public void setHighRiskCount(long highRiskCount) {
        this.highRiskCount = highRiskCount;
    }

    public long getMediumRiskCount() {
        return mediumRiskCount;
    }

    public void setMediumRiskCount(long mediumRiskCount) {
        this.mediumRiskCount = mediumRiskCount;
    }

    public long getLowRiskCount() {
        return lowRiskCount;
    }

    public void setLowRiskCount(long lowRiskCount) {
        this.lowRiskCount = lowRiskCount;
    }
} 