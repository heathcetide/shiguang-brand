package com.foodrecord.core.logging;

import java.util.Map;

public class PerformanceMetrics {
    private final Map<String, Double> averageResponseTimes;
    private final Map<String, Map<Integer, Double>> responseTimePercentiles;
    private final Map<String, Integer> errorCounts;
    private final Map<String, Double> throughput;

    public PerformanceMetrics(
        Map<String, Double> averageResponseTimes,
        Map<String, Map<Integer, Double>> responseTimePercentiles,
        Map<String, Integer> errorCounts,
        Map<String, Double> throughput
    ) {
        this.averageResponseTimes = averageResponseTimes;
        this.responseTimePercentiles = responseTimePercentiles;
        this.errorCounts = errorCounts;
        this.throughput = throughput;
    }

    public Map<String, Double> getAverageResponseTimes() {
        return averageResponseTimes;
    }

    public Map<String, Map<Integer, Double>> getResponseTimePercentiles() {
        return responseTimePercentiles;
    }

    public Map<String, Integer> getErrorCounts() {
        return errorCounts;
    }

    public Map<String, Double> getThroughput() {
        return throughput;
    }

    public boolean hasSignificantIssues() {
        // 检查是否存在显著的性能问题
        return hasHighResponseTimes() || hasHighErrorRate() || hasLowThroughput();
    }

    private boolean hasHighResponseTimes() {
        // 检查是否有端点的响应时间超过阈值
        return averageResponseTimes.values().stream()
            .anyMatch(time -> time > 1000); // 1秒阈值
    }

    private boolean hasHighErrorRate() {
        // 检查是否有端点的错误率超过阈值
        return errorCounts.values().stream()
            .anyMatch(count -> count > 100); // 100个错误阈值
    }

    private boolean hasLowThroughput() {
        // 检查是否有端点的吞吐量低于阈值
        return throughput.values().stream()
            .anyMatch(tps -> tps < 1.0); // 1 TPS阈值
    }
} 