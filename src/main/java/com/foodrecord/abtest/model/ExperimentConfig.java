package com.foodrecord.abtest.model;

import java.util.List;

public class ExperimentConfig {
    private String name;
    private List<String> variants;
    private double trafficPercentage;
    private List<String> metrics;
    private long duration;
    private String description;

    // Getters and setters
    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public List<String> getVariants() {
        return variants;
    }

    public void setVariants(List<String> variants) {
        this.variants = variants;
    }

    public double getTrafficPercentage() {
        return trafficPercentage;
    }

    public void setTrafficPercentage(double trafficPercentage) {
        this.trafficPercentage = trafficPercentage;
    }

    public List<String> getMetrics() {
        return metrics;
    }

    public void setMetrics(List<String> metrics) {
        this.metrics = metrics;
    }

    public long getDuration() {
        return duration;
    }

    public void setDuration(long duration) {
        this.duration = duration;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }
} 