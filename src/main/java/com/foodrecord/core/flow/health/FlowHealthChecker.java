package com.foodrecord.core.flow.health;

import com.foodrecord.core.flow.alert.AlertManager;
import com.foodrecord.core.flow.monitor.*;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.*;

@Component
public class FlowHealthChecker {
    private final FlowPerformanceMonitor performanceMonitor;
    private final SystemResourceMonitor systemMonitor;
    private final AlertManager alertManager;

    public FlowHealthChecker(FlowPerformanceMonitor performanceMonitor, 
                           SystemResourceMonitor systemMonitor, 
                           AlertManager alertManager) {
        this.performanceMonitor = performanceMonitor;
        this.systemMonitor = systemMonitor;
        this.alertManager = alertManager;
    }

    public HealthStatus checkFlowHealth(String flowId) {
        HealthStatus status = new HealthStatus(null,null,null,null,null);
//        status.setFlowId(flowId);
//        status.setCheckTime(LocalDateTime.now());
//
        // 检查性能指标
        checkPerformanceMetrics(flowId, status);
        
        // 检查系统资源
        checkSystemResources(status);
        
        // 检查错误率
        checkErrorRate(flowId, status);
        
        // 设置整体健康状态
        determineOverallHealth(status);
        
        return status;
    }
    
    private void checkPerformanceMetrics(String flowId, HealthStatus status) {
        Map<String, FlowPerformanceMonitor.PerformanceStats> stats = performanceMonitor.getStats(flowId);
        if (stats != null && !stats.isEmpty()) {
            FlowPerformanceMonitor.PerformanceStats flowStats = stats.values().iterator().next();
            if (flowStats.getAverageExecutionTime() > 5000) { // 5秒阈值
//                status.addIssue(new HealthIssue(
//                    Severity.WARNING,
//                    "High average execution time",
//                    String.format("Average execution time is %.2f ms",
//                        flowStats.getAverageExecutionTime())
//                ));
            }
        }
    }
    
    private void checkSystemResources(HealthStatus status) {
        SystemMetrics metrics = systemMonitor.collectMetrics();
        
        if (metrics.getCpuUsage() > 80) {
//            status.addIssue(new HealthIssue(
//                Severity.WARNING,
//                "High CPU usage",
//                String.format("CPU usage is %.2f%%", metrics.getCpuUsage())
//            ));
        }
        
        if (metrics.getMemoryUsage() > 85) {
//            status.addIssue(new HealthIssue(
//                Severity.CRITICAL,
//                "High memory usage",
//                String.format("Memory usage is %.2f%%", metrics.getMemoryUsage())
//            ));
        }
    }
    
    private void checkErrorRate(String flowId, HealthStatus status) {
        Map<String, FlowPerformanceMonitor.PerformanceStats> stats = performanceMonitor.getStats(flowId);
        if (stats != null && !stats.isEmpty()) {
            FlowPerformanceMonitor.PerformanceStats flowStats = stats.values().iterator().next();
            double errorRate = 1.0 - flowStats.getSuccessRate();
            if (errorRate > 0.1) { // 10% 错误率阈值
//                status.addIssue(new HealthIssue(
//                    Severity.WARNING,
//                    "High error rate",
//                    String.format("Error rate is %.2f%%", errorRate * 100)
//                ));
            }
        }
    }
    
    private void determineOverallHealth(HealthStatus status) {
        if (status.getIssues().isEmpty()) {
//            status.setOverallHealth(HealthLevel.HEALTHY);
            return;
        }
        
        boolean hasCritical = status.getIssues().stream()
            .anyMatch(issue -> issue.getSeverity() == Severity.CRITICAL);
            
        if (hasCritical) {
//            status.setOverallHealth(HealthLevel.CRITICAL);
        } else {
//            status.setOverallHealth(HealthLevel.WARNING);
        }
    }
} 