package com.foodrecord.core.flow.performance;

public class PerformanceMetrics {
    private final double latencyP50;
    private final double latencyP90;
    private final double latencyP99;
    private final double successRate;
    private final double throughput;
    private final double errorRate;

    public PerformanceMetrics(
            double latencyP50,
            double latencyP90,
            double latencyP99,
            double successRate,
            double throughput,
            double errorRate) {
        this.latencyP50 = latencyP50;
        this.latencyP90 = latencyP90;
        this.latencyP99 = latencyP99;
        this.successRate = successRate;
        this.throughput = throughput;
        this.errorRate = errorRate;
    }

    public double getLatencyP50() {
        return latencyP50;
    }

    public double getLatencyP90() {
        return latencyP90;
    }

    public double getLatencyP99() {
        return latencyP99;
    }

    public double getSuccessRate() {
        return successRate;
    }

    public double getThroughput() {
        return throughput;
    }

    public double getErrorRate() {
        return errorRate;
    }
} 