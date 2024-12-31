package com.foodrecord.test.stress;//package com.foodrecord.test.stress;
//
//import org.springframework.stereotype.Component;
//import lombok.extern.slf4j.Slf4j;
//import java.util.concurrent.*;
//
//@Slf4j
//@Component
//public class StressTestMonitor {
//    private final MetricsCollector metricsCollector;
//    private final AlertManager alertManager;
//    private final ScheduledExecutorService scheduler;
//
//    public void startMonitoring(StressTestContext context) {
//        // 1. 初始化监控
//        MetricsCollection metrics = initializeMetrics(context);
//
//        // 2. 启动实时监控
//        scheduler.scheduleAtFixedRate(() -> {
//            try {
//                // 收集当前指标
//                MetricSnapshot snapshot = metricsCollector.collectMetrics();
//                metrics.addSnapshot(snapshot);
//
//                // 分析指标
//                analyzeMetrics(metrics, context);
//
//                // 检查告警条件
//                checkAlertConditions(metrics, context);
//
//            } catch (Exception e) {
//                log.error("Error in metrics collection", e);
//            }
//        }, 0, 5, TimeUnit.SECONDS);
//    }
//
//    private void analyzeMetrics(MetricsCollection metrics, StressTestContext context) {
//        // 分析响应时间趋势
//        ResponseTimeAnalysis rtAnalysis =
//            metrics.analyzeResponseTimes(context.getThresholds());
//
//        // 分析错误率
//        ErrorRateAnalysis errorAnalysis =
//            metrics.analyzeErrorRates(context.getThresholds());
//
//        // 分析系统资源使用
//        ResourceUsageAnalysis resourceAnalysis =
//            metrics.analyzeResourceUsage(context.getThresholds());
//
//        // 更新测试状态
//        context.updateTestStatus(rtAnalysis, errorAnalysis, resourceAnalysis);
//    }
//
//    @Data
//    @Builder
//    public static class MetricSnapshot {
//        private final long timestamp;
//        private final Map<String, Double> responseTimePercentiles;
//        private final Map<String, Integer> errorCounts;
//        private final Map<String, Double> resourceUtilization;
//        private final int activeUsers;
//        private final double throughput;
//    }
//}