package com.foodrecord.core.db.health;

import java.util.Map;

public class ResourceUtilization {
    private final double cpuUsage;
    private final double memoryUsage;
    private final double diskIoUsage;
    private final double networkIoUsage;
    private final Map<String, Double> resourceTrends;

    public ResourceUtilization(double cpuUsage, double memoryUsage,
                             double diskIoUsage, double networkIoUsage,
                             Map<String, Double> resourceTrends) {
        this.cpuUsage = cpuUsage;
        this.memoryUsage = memoryUsage;
        this.diskIoUsage = diskIoUsage;
        this.networkIoUsage = networkIoUsage;
        this.resourceTrends = resourceTrends;
    }

    public double getCpuUsage() {
        return cpuUsage;
    }

    public double getMemoryUsage() {
        return memoryUsage;
    }

    public double getDiskIoUsage() {
        return diskIoUsage;
    }

    public double getNetworkIoUsage() {
        return networkIoUsage;
    }

    public Map<String, Double> getResourceTrends() {
        return resourceTrends;
    }
}
