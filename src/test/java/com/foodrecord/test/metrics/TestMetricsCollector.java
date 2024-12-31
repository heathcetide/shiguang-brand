package com.foodrecord.test.metrics;//package com.foodrecord.test.metrics;
//
//import org.springframework.stereotype.Component;
//import lombok.extern.slf4j.Slf4j;
//import io.micrometer.core.instrument.MeterRegistry;
//import java.util.concurrent.ConcurrentHashMap;
//
//@Slf4j
//@Component
//public class TestMetricsCollector {
//    private final MeterRegistry registry;
//    private final MetricsBuffer metricsBuffer;
//    private final MetricsAggregator aggregator;
//
//    public void recordTestExecution(TestExecutionMetrics metrics) {
//        // 记录测试执行时间
//        registry.timer("test.execution.time")
//            .record(metrics.getExecutionTime());
//
//        // 记录测试结果
//        registry.counter("test.results",
//            "result", metrics.isSuccess() ? "success" : "failure")
//            .increment();
//
//        // 记录资源使用情况
//        recordResourceMetrics(metrics.getResourceMetrics());
//
//        // 发送到监控系统
//        metricsBuffer.buffer(metrics);
//    }
//
//    public TestMetricsReport generateReport(TimeWindow window) {
//        List<TestExecutionMetrics> metrics =
//            metricsBuffer.getMetrics(window);
//
//        return TestMetricsReport.builder()
//            .successRate(calculateSuccessRate(metrics))
//            .averageExecutionTime(calculateAverageExecutionTime(metrics))
//            .resourceUtilization(calculateResourceUtilization(metrics))
//            .trends(calculateTrends(metrics))
//            .anomalies(detectAnomalies(metrics))
//            .build();
//    }
//
//    @Data
//    @Builder
//    public static class TestExecutionMetrics {
//        private final String testId;
//        private final Duration executionTime;
//        private final boolean success;
//        private final ResourceMetrics resourceMetrics;
//        private final Map<String, Double> customMetrics;
//        private final List<TestEvent> events;
//    }
//}