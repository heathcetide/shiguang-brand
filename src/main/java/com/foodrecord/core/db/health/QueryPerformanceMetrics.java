package com.foodrecord.core.db.health;

import java.time.Duration;

public class QueryPerformanceMetrics {
    private final double averageResponseTime;
    private final double p95ResponseTime;
    private final double p99ResponseTime;
    private final int queriesPerSecond;
    private final int slowQueryCount;
    private final Duration slowQueryThreshold;

    public QueryPerformanceMetrics(double averageResponseTime, double p95ResponseTime,
                                 double p99ResponseTime, int queriesPerSecond,
                                 int slowQueryCount, Duration slowQueryThreshold) {
        this.averageResponseTime = averageResponseTime;
        this.p95ResponseTime = p95ResponseTime;
        this.p99ResponseTime = p99ResponseTime;
        this.queriesPerSecond = queriesPerSecond;
        this.slowQueryCount = slowQueryCount;
        this.slowQueryThreshold = slowQueryThreshold;
    }

    public double getAverageResponseTime() {
        return averageResponseTime;
    }

    public double getP95ResponseTime() {
        return p95ResponseTime;
    }

    public double getP99ResponseTime() {
        return p99ResponseTime;
    }

    public int getQueriesPerSecond() {
        return queriesPerSecond;
    }

    public int getSlowQueryCount() {
        return slowQueryCount;
    }

    public Duration getSlowQueryThreshold() {
        return slowQueryThreshold;
    }
}
