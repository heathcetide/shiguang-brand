package com.foodrecord.core.flow.predictor;

import java.time.LocalDateTime;
import org.deeplearning4j.common.resources.ResourceType;

public class ResourceUsagePoint {
    private LocalDateTime timestamp;
    private ResourceType resourceType;
    private double usage;

    public ResourceUsagePoint(LocalDateTime timestamp, ResourceType resourceType, double usage) {
        this.timestamp = timestamp;
        this.resourceType = resourceType;
        this.usage = usage;
    }

    public LocalDateTime getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(LocalDateTime timestamp) {
        this.timestamp = timestamp;
    }

    public ResourceType getResourceType() {
        return resourceType;
    }

    public void setResourceType(ResourceType resourceType) {
        this.resourceType = resourceType;
    }

    public double getUsage() {
        return usage;
    }

    public void setUsage(double usage) {
        this.usage = usage;
    }
} 