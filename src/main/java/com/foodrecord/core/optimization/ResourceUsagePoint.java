package com.foodrecord.core.optimization;

public class ResourceUsagePoint {
    private final long timestamp;
    private final String resourceType;
    private final double usage;

    public ResourceUsagePoint(long timestamp, String resourceType, double usage) {
        this.timestamp = timestamp;
        this.resourceType = resourceType;
        this.usage = usage;
    }

    public long getTimestamp() {
        return timestamp;
    }

    public String getResourceType() {
        return resourceType;
    }

    public double getUsage() {
        return usage;
    }
} 