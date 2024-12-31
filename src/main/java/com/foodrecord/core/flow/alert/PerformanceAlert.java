package com.foodrecord.core.flow.alert;

import com.foodrecord.core.logging.PerformanceReport;
import java.util.List;

public class PerformanceAlert {
    private final PerformanceReport report;
    private final List<String> recommendations;

    public PerformanceAlert(PerformanceReport report) {
        this.report = report;
        this.recommendations = generateRecommendations();
    }

    public PerformanceReport getReport() {
        return report;
    }

    public List<String> getRecommendations() {
        return recommendations;
    }

    private List<String> generateRecommendations() {
        List<String> recommendations = new java.util.ArrayList<>();
        
        // 检查响应时间
        report.getMetrics().getAverageResponseTimes().forEach((endpoint, time) -> {
            if (time > 1000) {
                recommendations.add(String.format(
                    "Endpoint '%s' has high response time (%.2fms). Consider optimization.",
                    endpoint, time));
            }
        });
        
        // 检查错误率
        report.getMetrics().getErrorCounts().forEach((endpoint, count) -> {
            if (count > 100) {
                recommendations.add(String.format(
                    "Endpoint '%s' has high error count (%d). Investigate error causes.",
                    endpoint, count));
            }
        });
        
        // 检查吞吐量
        report.getMetrics().getThroughput().forEach((endpoint, tps) -> {
            if (tps < 1.0) {
                recommendations.add(String.format(
                    "Endpoint '%s' has low throughput (%.2f TPS). Consider scaling.",
                    endpoint, tps));
            }
        });
        
        // 检查性能异常
        report.getAnomalies().forEach(anomaly -> {
            recommendations.add(String.format(
                "Performance anomaly detected: %s", anomaly.toString()));
        });
        
        return recommendations;
    }
} 