package com.foodrecord.core.logging;

import java.time.Duration;

public class TimeToImpact {
    private final Duration estimatedTime;
    private final double confidence;
    private final ImpactType impactType;

    public TimeToImpact(Duration estimatedTime, double confidence, ImpactType impactType) {
        this.estimatedTime = estimatedTime;
        this.confidence = confidence;
        this.impactType = impactType;
    }

    public Duration getEstimatedTime() {
        return estimatedTime;
    }

    public double getConfidence() {
        return confidence;
    }

    public ImpactType getImpactType() {
        return impactType;
    }

    public boolean isImminent() {
        return estimatedTime.toMinutes() < 30;
    }

    public enum ImpactType {
        IMMEDIATE,
        SHORT_TERM,
        LONG_TERM,
        GRADUAL
    }
} 