package com.foodrecord.core.logging;

import com.foodrecord.core.db.health.PerformanceAnalysis;
import org.apache.kafka.streams.kstream.internals.TimeWindow;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class PerformanceAnalyzerImpl implements PerformanceAnalyzer {

    @Override
    public PerformanceAnalysis analyze(List<ParsedLog> logs) {
        PerformanceAnalysis analysis = new PerformanceAnalysis(null,null,null,null);

        // 提取日志中的性能信息
        long totalExecutionTime = 0;
        int count = 0;

        for (ParsedLog log : logs) {
            if (log.getPerformanceData() != null) {
                totalExecutionTime += log.getPerformanceData().getExecutionTime();
                count++;
            }
        }

        double avgExecutionTime = count > 0 ? (double) totalExecutionTime / count : 0.0;

//        // 构建分析结果
//        analysis.setTotalLogs(logs.size());
//        analysis.setAverageExecutionTime(avgExecutionTime);
//        analysis.setIssues(detectPerformanceIssues(logs, avgExecutionTime));

        return analysis;
    }

    @Override
    public PerformanceAnalysis analyze(DataSource dataSource) {
        PerformanceAnalysis analysis = new PerformanceAnalysis(null,null,null,null);

        try (Connection connection = dataSource.getConnection()) {
            long startTime = System.currentTimeMillis();
            boolean isValid = connection.isValid(5);
            long responseTime = System.currentTimeMillis() - startTime;

//            analysis.setDataSourceAvailable(isValid);
//            analysis.setResponseTime(responseTime);

            if (!isValid) {
//                analysis.addIssue("DataSource is not valid.");
            } else if (responseTime > 1000) {
//                analysis.addIssue("DataSource response time is too high: " + responseTime + "ms.");
            }
        } catch (SQLException e) {
//            analysis.addIssue("Failed to connect to DataSource: " + e.getMessage());
        }

        return analysis;
    }

    @Override
    public PerformanceAnalysis analyzeWithMetrics(List<ParsedLog> logs, List<String> metricNames) {
        PerformanceAnalysis analysis = new PerformanceAnalysis(null,null,null,null);

        Map<String, Double> metrics = new HashMap<>();

        for (ParsedLog log : logs) {
            if (log.getPerformanceData() != null) {
                for (String metricName : metricNames) {
                    Double value = log.getPerformanceData().getMetrics().get(metricName);
                    if (value != null) {
                        metrics.merge(metricName, value, Double::sum);
                    }
                }
            }
        }

        // 平均化指标
        for (String metricName : metrics.keySet()) {
            metrics.put(metricName, metrics.get(metricName) / logs.size());
        }

//        analysis.setMetrics(metrics);
        return analysis;
    }

    @Override
    public PerformanceMetrics analyze(List<ParsedLog> logs, TimeWindow window) {
        PerformanceMetrics metrics = new PerformanceMetrics(null,null,null,null);

        long totalExecutionTime = 0;
        long totalLogs = 0;

        for (ParsedLog log : logs) {
//            if (log.getTimestamp().isAfter(window.start()) && log.getTimestamp().isBefore(window.end())) {
//                totalExecutionTime += log.getPerformanceData().getExecutionTime();
//                totalLogs++;
//            }
        }

//        metrics.setTotalLogs(totalLogs);
//        metrics.setAverageExecutionTime(totalLogs > 0 ? (double) totalExecutionTime / totalLogs : 0.0);

        return metrics;
    }

    private List<String> detectPerformanceIssues(List<ParsedLog> logs, double avgExecutionTime) {
        List<String> issues = new ArrayList<>();

        for (ParsedLog log : logs) {
            if (log.getPerformanceData() != null) {
                if (log.getPerformanceData().getExecutionTime() > avgExecutionTime * 2) {
                    issues.add("Log " + log.getLogId() + " has abnormally high execution time.");
                }
            }
        }

        return issues;
    }
}
