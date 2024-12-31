package com.foodrecord.core.logging;

import java.util.Set;

public class RemediationAction {
    private final String description;
    private final Severity priority;
    private final Set<String> targetServices;
    private final int estimatedTimeMinutes;

    public RemediationAction(String description, Severity priority, Set<String> targetServices, int estimatedTimeMinutes) {
        this.description = description;
        this.priority = priority;
        this.targetServices = targetServices;
        this.estimatedTimeMinutes = estimatedTimeMinutes;
    }

    public String getDescription() {
        return description;
    }

    public Severity getPriority() {
        return priority;
    }

    public Set<String> getTargetServices() {
        return targetServices;
    }

    public int getEstimatedTimeMinutes() {
        return estimatedTimeMinutes;
    }

    public boolean isUrgent() {
        return priority.isHigherThan(Severity.MEDIUM);
    }

    @Override
    public String toString() {
        return String.format("Action: %s (Priority: %s, ETA: %d minutes)", 
            description, priority, estimatedTimeMinutes);
    }
} 