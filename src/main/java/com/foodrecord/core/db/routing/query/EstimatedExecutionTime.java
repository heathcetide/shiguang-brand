package com.foodrecord.core.db.routing.query;

import java.time.Duration;

public class EstimatedExecutionTime {
    private final Duration minTime;
    private final Duration maxTime;
    private final Duration avgTime;

    public EstimatedExecutionTime(Duration minTime, Duration maxTime, Duration avgTime) {
        this.minTime = minTime;
        this.maxTime = maxTime;
        this.avgTime = avgTime;
    }

    public Duration getMinTime() {
        return minTime;
    }

    public Duration getMaxTime() {
        return maxTime;
    }

    public Duration getAvgTime() {
        return avgTime;
    }
}
