package com.foodrecord.abtest.model;

import java.util.List;
import java.util.UUID;

public class Experiment {
    private String id;
    private String name;
    private List<String> variants;
    private double trafficPercentage;
    private List<String> metrics;
    private boolean active;
    private long startTime;
    private long endTime;

    public Experiment(String name, List<String> variants, 
                     double trafficPercentage, List<String> metrics) {
        this.id = UUID.randomUUID().toString();
        this.name = name;
        this.variants = variants;
        this.trafficPercentage = trafficPercentage;
        this.metrics = metrics;
        this.active = true;
        this.startTime = System.currentTimeMillis();
    }
    public long getMinSampleSize() {
        // 假设每个实验的最小样本量要求为 1000
        return 1000L;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

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

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }

    public long getStartTime() {
        return startTime;
    }

    public void setStartTime(long startTime) {
        this.startTime = startTime;
    }

    public long getEndTime() {
        return endTime;
    }

    public void setEndTime(long endTime) {
        this.endTime = endTime;
    }
}