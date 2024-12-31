package com.foodrecord.core.logging;

import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class AnomalyDetector {
    private final double responseTimeThreshold = 1000; // 1秒
    private final double errorRateThreshold = 0.1; // 10%
    private final double throughputDeviationThreshold = 0.5; // 50%

    public List<PerformanceAnomaly> detectPerformanceAnomalies(PerformanceMetrics metrics) {
        List<PerformanceAnomaly> anomalies = new ArrayList<>();
        
        // 检测响应时间异常
        detectResponseTimeAnomalies(metrics, anomalies);
        
        // 检测错误率异常
        detectErrorRateAnomalies(metrics, anomalies);
        
        // 检测吞吐量异常
        detectThroughputAnomalies(metrics, anomalies);
        
        return anomalies;
    }
    
    private void detectResponseTimeAnomalies(PerformanceMetrics metrics, List<PerformanceAnomaly> anomalies) {
        metrics.getAverageResponseTimes().forEach((endpoint, avgTime) -> {
            if (avgTime > responseTimeThreshold) {
                anomalies.add(new PerformanceAnomaly(
                    "HIGH_RESPONSE_TIME",
                    endpoint,
                    avgTime,
                    responseTimeThreshold,
                    calculateSeverity(avgTime / responseTimeThreshold)
                ));
            }
        });
    }
    
    private void detectErrorRateAnomalies(PerformanceMetrics metrics, List<PerformanceAnomaly> anomalies) {
        metrics.getErrorCounts().forEach((endpoint, errorCount) -> {
            double totalRequests = metrics.getThroughput().getOrDefault(endpoint, 0.0);
            if (totalRequests > 0) {
                double errorRate = errorCount / totalRequests;
                if (errorRate > errorRateThreshold) {
                    anomalies.add(new PerformanceAnomaly(
                        "HIGH_ERROR_RATE",
                        endpoint,
                        errorRate,
                        errorRateThreshold,
                        calculateSeverity(errorRate / errorRateThreshold)
                    ));
                }
            }
        });
    }
    
    private void detectThroughputAnomalies(PerformanceMetrics metrics, List<PerformanceAnomaly> anomalies) {
        Map<String, Double> throughput = metrics.getThroughput();
        double avgThroughput = throughput.values().stream()
            .mapToDouble(Double::doubleValue)
            .average()
            .orElse(0.0);
            
        throughput.forEach((endpoint, tps) -> {
            double deviation = Math.abs(tps - avgThroughput) / avgThroughput;
            if (deviation > throughputDeviationThreshold) {
                anomalies.add(new PerformanceAnomaly(
                    "ABNORMAL_THROUGHPUT",
                    endpoint,
                    tps,
                    avgThroughput,
                    calculateSeverity(deviation / throughputDeviationThreshold)
                ));
            }
        });
    }
    
    private Severity calculateSeverity(double ratio) {
        if (ratio > 3.0) return Severity.CRITICAL;
        if (ratio > 2.0) return Severity.HIGH;
        if (ratio > 1.5) return Severity.MEDIUM;
        return Severity.LOW;
    }
} 