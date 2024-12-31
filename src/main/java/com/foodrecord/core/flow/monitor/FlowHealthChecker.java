package com.foodrecord.core.flow.monitor;

import java.util.ArrayList;
import java.util.List;

public class FlowHealthChecker {
    private static final double ERROR_RATE_THRESHOLD = 0.1; // 10%
    private static final double CPU_USAGE_THRESHOLD = 80.0; // 80%
    private static final double MEMORY_USAGE_THRESHOLD = 85.0; // 85%

    public List<HealthIssue> checkErrorRate(PerformanceStats stats) {
        List<HealthIssue> issues = new ArrayList<>();
        double errorRate = 1.0 - stats.getSuccessRate();
        
        if (errorRate > ERROR_RATE_THRESHOLD) {
//            issues.add(new HealthIssue(
//                Severity.WARNING,
//                "Flow error rate is too high",
//                String.format("Current error rate: %.2f%%", errorRate * 100)
//            ));
        }
        return issues;
    }

    public List<HealthIssue> checkSystemMetrics(SystemMetrics metrics) {
        List<HealthIssue> issues = new ArrayList<>();
        
        if (metrics.getCpuUsage() > CPU_USAGE_THRESHOLD) {
//            issues.add(new HealthIssue(
//                Severity.WARNING,
//                "CPU usage is too high",
//                String.format("Current CPU usage: %.2f%%", metrics.getCpuUsage())
//            ));
        }
        
        if (metrics.getMemoryUsage() > MEMORY_USAGE_THRESHOLD) {
//            issues.add(new HealthIssue(
//                Severity.CRITICAL,
//                "Memory usage is too high",
//                String.format("Current memory usage: %.2f%%", metrics.getMemoryUsage())
//            ));
        }
        
        return issues;
    }

    public HealthLevel evaluateOverallHealth(List<HealthIssue> issues) {
        if (issues.isEmpty()) {
            return HealthLevel.HEALTHY;
        }
        
        boolean hasCritical = issues.stream()
            .anyMatch(issue -> issue.getSeverity() == Severity.CRITICAL);
            
        if (hasCritical) {
            return HealthLevel.CRITICAL;
        }
        
        return HealthLevel.WARNING;
    }
} 