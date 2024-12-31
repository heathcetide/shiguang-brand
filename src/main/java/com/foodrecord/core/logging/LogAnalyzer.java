package com.foodrecord.core.logging;

import com.foodrecord.core.db.health.DataSourceAlert;
import com.foodrecord.core.flow.alert.Alert;
import com.foodrecord.core.flow.alert.AlertManager;
import com.foodrecord.core.flow.alert.ErrorAlert;
import com.foodrecord.core.flow.alert.PerformanceAlert;
import com.foodrecord.core.flow.dashboard.DashboardOverview.SystemMetrics;
import com.foodrecord.core.flow.monitor.HealthStatus;
import org.apache.kafka.streams.kstream.internals.TimeWindow;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import java.util.*;
import java.time.LocalDateTime;

@Component
public class LogAnalyzer {
    private ErrorPatternDetector errorPatternDetector;
    private PerformanceAnalyzer performanceAnalyzer;
    private AnomalyDetector anomalyDetector;
    private AlertManager alertManager;
    private MetricsRepository metricsRepository;

    public LogAnalyzer() {
        // 默认构造函数
    }

    @Autowired
    public LogAnalyzer(
            ErrorPatternDetector errorPatternDetector,
            PerformanceAnalyzer performanceAnalyzer,
            AnomalyDetector anomalyDetector,
            AlertManager alertManager,
            MetricsRepository metricsRepository) {
        this.errorPatternDetector = errorPatternDetector;
        this.performanceAnalyzer = performanceAnalyzer;
        this.anomalyDetector = anomalyDetector;
        this.alertManager = alertManager;
        this.metricsRepository = metricsRepository;
    }

    public void analyzeErrorPattern(ParsedLog logEntry) {
        // 检测错误模式
        List<ErrorPattern> patterns = errorPatternDetector.detectPatterns(logEntry);
        
        // 分析错误影响
        ErrorImpactAnalysis impact = analyzeErrorImpact(patterns);
        
        // 生成修复建议
        List<RemediationAction> actions = generateRemediationActions(patterns);
        
        // 如果需要，发送告警
        if (impact.getSeverity().isHigherThan(Severity.MEDIUM)) {
            alertManager.sendAlert(new DataSourceAlert(null));
        }
    }
    
    public void analyzePerformance(List<ParsedLog> logs, TimeWindow window) {
        // 分析响应时间
        PerformanceMetrics metrics = performanceAnalyzer.analyze(logs, window);
        
        // 检测性能异常
        List<PerformanceAnomaly> anomalies = 
            anomalyDetector.detectPerformanceAnomalies(metrics);
            
        // 生成性能报告
        PerformanceReport report = new PerformanceReport(metrics, anomalies);
        
        // 存储分析结果
        metricsRepository.save(report);
        
        // 如果发现严重的性能问题，发送告警
        if (report.hasSignificantIssues()) {
            alertManager.sendAlert(new DataSourceAlert(new HealthStatus(null,null,null,null,null)));
        }
    }

    private ErrorImpactAnalysis analyzeErrorImpact(List<ErrorPattern> patterns) {
        Set<String> affectedServices = new HashSet<>();
        Map<String, Integer> errorDistribution = new HashMap<>();
        Map<String, Double> serviceHealthMetrics = new HashMap<>();
        List<String> potentialCauses = new ArrayList<>();
        
        for (ErrorPattern pattern : patterns) {
            // 收集受影响的服务
            affectedServices.addAll(pattern.getAffectedServices());
            
            // 统计错误分布
            pattern.getErrorDistribution().forEach((type, count) -> 
                errorDistribution.merge(type, count, Integer::sum));
            
            // 分析潜在原因
            potentialCauses.add(analyzePotentialCause(pattern));
        }
        
        // 计算服务健康度
        affectedServices.forEach(service -> 
            serviceHealthMetrics.put(service, calculateServiceHealth(service, patterns)));
        
        // 确定严重程度
        Severity severity = determineSeverity(patterns, affectedServices.size());
        
        return new ErrorImpactAnalysis(
            severity,
            new ArrayList<>(affectedServices),
            errorDistribution,
            serviceHealthMetrics,
            potentialCauses
        );
    }

    private List<RemediationAction> generateRemediationActions(List<ErrorPattern> patterns) {
        List<RemediationAction> actions = new ArrayList<>();
        
        for (ErrorPattern pattern : patterns) {
            // 根据错误模式生成修复建议
            String actionDescription = generateActionDescription(pattern);
            Severity priority = determinePriority(pattern);
            
            actions.add(new RemediationAction(
                actionDescription,
                priority,
                pattern.getAffectedServices(),
                estimateTimeToResolve(pattern)
            ));
        }
        
        return actions;
    }

    private String analyzePotentialCause(ErrorPattern pattern) {
        // 基于错误模式分析潜在原因
        if (pattern.getPattern().contains("OutOfMemoryError")) {
            return "Memory leak or insufficient memory allocation";
        } else if (pattern.getPattern().contains("TimeoutException")) {
            return "Service response time exceeded threshold";
        } else if (pattern.getPattern().contains("ConnectionException")) {
            return "Network connectivity issues";
        }
        return "Unknown cause - requires further investigation";
    }

    private double calculateServiceHealth(String service, List<ErrorPattern> patterns) {
        // 计算服务健康度（0-1）
        long totalErrors = patterns.stream()
            .filter(p -> p.getAffectedServices().contains(service))
            .mapToLong(p -> p.getErrorDistribution().values().stream().mapToInt(Integer::intValue).sum())
            .sum();
            
        return Math.max(0.0, 1.0 - (totalErrors / 1000.0));
    }

    private Severity determineSeverity(List<ErrorPattern> patterns, int affectedServicesCount) {
        // 确定整体严重程度
        if (affectedServicesCount > 3) {
            return Severity.CRITICAL;
        }
        
        boolean hasCriticalErrors = patterns.stream()
            .anyMatch(p -> p.getPattern().contains("CRITICAL"));
            
        if (hasCriticalErrors) {
            return Severity.HIGH;
        }
        
        return Severity.MEDIUM;
    }

    private String generateActionDescription(ErrorPattern pattern) {
        // 生成修复建议描述
        if (pattern.getPattern().contains("OutOfMemoryError")) {
            return "Increase memory allocation and investigate memory leaks";
        } else if (pattern.getPattern().contains("TimeoutException")) {
            return "Optimize service response time and increase timeout threshold";
        } else if (pattern.getPattern().contains("ConnectionException")) {
            return "Check network connectivity and service availability";
        }
        return "Investigate logs and monitor system behavior";
    }

    private Severity determinePriority(ErrorPattern pattern) {
        // 确定修复优先级
        if (pattern.getFrequency() > 100) {
            return Severity.CRITICAL;
        } else if (pattern.getFrequency() > 50) {
            return Severity.HIGH;
        } else if (pattern.getFrequency() > 10) {
            return Severity.MEDIUM;
        }
        return Severity.LOW;
    }

    private int estimateTimeToResolve(ErrorPattern pattern) {
        // 估计解决时间（分钟）
        if (pattern.getPattern().contains("CRITICAL")) {
            return 30;
        } else if (pattern.getAffectedServices().size() > 2) {
            return 60;
        }
        return 120;
    }

    public void analyzeSystemHealth(SystemMetrics metrics) {
        // 检查系统资源使用情况
        if (metrics.hasHighUsage()) {
            List<String> recommendations = new ArrayList<>();
            
            if (metrics.getCpuUsage() > 80) {
                recommendations.add(String.format(
                    "High CPU usage detected: %.2f%%. Consider scaling up or optimizing CPU-intensive operations.",
                    metrics.getCpuUsage()));
            }
            
            if (metrics.getMemoryUsage() > 80) {
                recommendations.add(String.format(
                    "High memory usage detected: %.2f%%. Check for memory leaks or increase memory allocation.",
                    metrics.getMemoryUsage()));
            }
            
            if (metrics.getDiskUsage() > 80) {
                recommendations.add(String.format(
                    "High disk usage detected: %.2f%%. Clean up unnecessary files or add more storage.",
                    metrics.getDiskUsage()));
            }
            
            // 检查网络流量
            metrics.getNetworkTraffic().forEach((interface_, traffic) -> {
                if (traffic > 100) { // 假设阈值为100MB/s
                    recommendations.add(String.format(
                        "High network traffic on interface %s: %.2f MB/s. Monitor for potential network bottlenecks.",
                        interface_, traffic));
                }
            });
            
            // 如果有任何问题，发送系统告警
            if (!recommendations.isEmpty()) {
                Map<String, Object> alertDetails = new HashMap<>();
                alertDetails.put("metrics", metrics);
                alertDetails.put("recommendations", recommendations);
                
                alertManager.sendAlert(new DataSourceAlert(
                        new HealthStatus(null,null,null,null,null)

                ));
            }
        }
    }

    public static class ErrorPattern {
        private final String pattern;
        private final int frequency;
        private final LocalDateTime firstOccurrence;
        private final LocalDateTime lastOccurrence;
        private final Set<String> affectedServices;
        private final Map<String, Integer> errorDistribution;

        public ErrorPattern(String pattern, int frequency, LocalDateTime firstOccurrence, LocalDateTime lastOccurrence, Set<String> affectedServices, Map<String, Integer> errorDistribution) {
            this.pattern = pattern;
            this.frequency = frequency;
            this.firstOccurrence = firstOccurrence;
            this.lastOccurrence = lastOccurrence;
            this.affectedServices = affectedServices;
            this.errorDistribution = errorDistribution;
        }

        public String getPattern() {
            return pattern;
        }

        public int getFrequency() {
            return frequency;
        }

        public LocalDateTime getFirstOccurrence() {
            return firstOccurrence;
        }

        public LocalDateTime getLastOccurrence() {
            return lastOccurrence;
        }

        public Set<String> getAffectedServices() {
            return affectedServices;
        }

        public Map<String, Integer> getErrorDistribution() {
            return errorDistribution;
        }
    }
} 