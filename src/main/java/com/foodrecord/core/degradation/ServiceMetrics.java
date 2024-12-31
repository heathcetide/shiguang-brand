package com.foodrecord.core.degradation;

import com.foodrecord.core.flow.performance.PerformanceMetrics;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

public class ServiceMetrics {
    private final String serviceId;
    private final PerformanceMetrics performance;
    private final Map<String, Double> errorRates;
    private final LocalDateTime collectionTime;
    private final long totalRequests;
    private final long failedRequests;
    private final double averageResponseTime;
    private final AtomicInteger concurrentRequests;

    public ServiceMetrics(
            String serviceId,
            PerformanceMetrics performance,
            Map<String, Double> errorRates,
            LocalDateTime collectionTime,
            long totalRequests,
            long failedRequests,
            double averageResponseTime) {
        this.serviceId = serviceId;
        this.performance = performance;
        this.errorRates = errorRates;
        this.collectionTime = collectionTime;
        this.totalRequests = totalRequests;
        this.failedRequests = failedRequests;
        this.averageResponseTime = averageResponseTime;
        this.concurrentRequests = new AtomicInteger(0);
    }

    public String getServiceId() {
        return serviceId;
    }

    public PerformanceMetrics getPerformance() {
        return performance;
    }

    public Map<String, Double> getErrorRates() {
        return errorRates;
    }

    public LocalDateTime getCollectionTime() {
        return collectionTime;
    }

    public long getTotalRequests() {
        return totalRequests;
    }

    public long getFailedRequests() {
        return failedRequests;
    }

    public double getErrorRate() {
        return totalRequests == 0 ? 0 : (double) failedRequests / totalRequests;
    }

    public double getAverageResponseTime() {
        return averageResponseTime;
    }

    public int getConcurrentRequests() {
        return concurrentRequests.get();
    }

    public void incrementConcurrentRequests() {
        concurrentRequests.incrementAndGet();
    }

    public void decrementConcurrentRequests() {
        concurrentRequests.decrementAndGet();
    }
} 