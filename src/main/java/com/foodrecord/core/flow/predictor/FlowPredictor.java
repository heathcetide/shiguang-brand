package com.foodrecord.core.flow.predictor;

import com.foodrecord.core.flow.analytics.FlowAnalytics;
import org.deeplearning4j.common.resources.ResourceType;
import org.springframework.stereotype.Component;
import java.util.*;
import java.time.LocalDateTime;
import org.apache.commons.math3.stat.regression.SimpleRegression;

@Component
public class FlowPredictor {
    private final FlowAnalytics flowAnalytics;
    private static final double DEGRADATION_THRESHOLD = 0.1; // 10%性能退化阈值
    private static final double PROBABILITY_THRESHOLD = 0.7; // 70%概率阈值

    public FlowPredictor(FlowAnalytics flowAnalytics) {
        this.flowAnalytics = flowAnalytics;
    }

    public PredictionReport predictPerformance(String flowId, 
                                             LocalDateTime targetTime) {
        PredictionReport report = new PredictionReport();
        report.setFlowId(flowId);
        report.setTargetTime(targetTime);
        
        // 预测执行时间
        predictExecutionTime(flowId, targetTime, report);
        
        // 预测资源使用
        predictResourceUsage(flowId, targetTime, report);
        
        // 预测可能的问题
        predictPotentialIssues(flowId, targetTime, report);
        
        return report;
    }
    
    private void predictExecutionTime(String flowId, 
                                    LocalDateTime targetTime, 
                                    PredictionReport report) {
        List<ExecutionTimePoint> history = 
            flowAnalytics.getHistoricalExecutionTimes(flowId);
            
        SimpleRegression regression = new SimpleRegression();
        history.forEach(point -> 
            regression.addData(point.getTimestamp().toEpochSecond(java.time.ZoneOffset.UTC), 
                             point.getDuration()));
                             
        double predictedDuration = regression.predict(
            targetTime.toEpochSecond(java.time.ZoneOffset.UTC));
            
        report.setPredictedExecutionTime(predictedDuration);
        report.setConfidenceLevel(regression.getRSquare());
    }
    
    private void predictResourceUsage(String flowId, 
                                    LocalDateTime targetTime,
                                    PredictionReport report) {
        Map<ResourceType, Double> predictions = new EnumMap<>(ResourceType.class);
        
        for (ResourceType type : ResourceType.values()) {
            List<ResourceUsagePoint> history = 
                flowAnalytics.getHistoricalResourceUsage(flowId, type);
                
            SimpleRegression regression = new SimpleRegression();
            history.forEach(point -> 
                regression.addData(point.getTimestamp().toEpochSecond(java.time.ZoneOffset.UTC), 
                                 point.getUsage()));
                                 
            predictions.put(type, regression.predict(
                targetTime.toEpochSecond(java.time.ZoneOffset.UTC)));
        }
        
        report.setPredictedResourceUsage(predictions);
    }
    
    private void predictPotentialIssues(String flowId, 
                                      LocalDateTime targetTime,
                                      PredictionReport report) {
        List<PredictionReport.PotentialIssue> potentialIssues = new ArrayList<>();
        
        // 分析性能趋势
        if (isPerformanceDegrading(flowId)) {
            potentialIssues.add(new PredictionReport.PotentialIssue(
                IssueType.PERFORMANCE_DEGRADATION,
                "Performance is likely to degrade",
                calculateProbability(flowId, IssueType.PERFORMANCE_DEGRADATION)
            ));
        }
        
        // 分析资源使用趋势
        Map<ResourceType, Double> resourceTrends = analyzeResourceTrends(flowId);
        resourceTrends.forEach((type, trend) -> {
            if (trend > 0.8) { // 资源使用快速增长
                potentialIssues.add(new PredictionReport.PotentialIssue(
                    IssueType.RESOURCE_EXHAUSTION,
                    String.format("%s usage is likely to exceed limits", type),
                    trend
                ));
            }
        });
        
        report.setPotentialIssues(potentialIssues);
    }

    private boolean isPerformanceDegrading(String flowId) {
        List<ExecutionTimePoint> history = flowAnalytics.getHistoricalExecutionTimes(flowId);
        if (history.size() < 2) {
            return false;
        }

        SimpleRegression regression = new SimpleRegression();
        history.forEach(point -> 
            regression.addData(point.getTimestamp().toEpochSecond(java.time.ZoneOffset.UTC), 
                             point.getDuration()));

        // 如果斜率为正且显著，说明性能在退化
        return regression.getSlope() > DEGRADATION_THRESHOLD && 
               regression.getRSquare() > PROBABILITY_THRESHOLD;
    }

    private double calculateProbability(String flowId, IssueType issueType) {
        // 基于历史数据和问题类型计算概率
        switch (issueType) {
            case PERFORMANCE_DEGRADATION:
                return calculatePerformanceDegradationProbability(flowId);
            case RESOURCE_EXHAUSTION:
                return calculateResourceExhaustionProbability(flowId);
            default:
                return 0.0;
        }
    }

    private double calculatePerformanceDegradationProbability(String flowId) {
        List<ExecutionTimePoint> history = flowAnalytics.getHistoricalExecutionTimes(flowId);
        if (history.size() < 2) {
            return 0.0;
        }

        SimpleRegression regression = new SimpleRegression();
        history.forEach(point -> 
            regression.addData(point.getTimestamp().toEpochSecond(java.time.ZoneOffset.UTC), 
                             point.getDuration()));

        // 使用R²作为概率的一个因子
        return regression.getSlope() > 0 ? regression.getRSquare() : 0.0;
    }

    private double calculateResourceExhaustionProbability(String flowId) {
        // 分析资源使用趋势和当前使用水平
        Map<ResourceType, Double> trends = analyzeResourceTrends(flowId);
        return trends.values().stream()
            .mapToDouble(trend -> trend)
            .max()
            .orElse(0.0);
    }

    private Map<ResourceType, Double> analyzeResourceTrends(String flowId) {
        Map<ResourceType, Double> trends = new EnumMap<>(ResourceType.class);
        
        for (ResourceType type : ResourceType.values()) {
            List<ResourceUsagePoint> history = 
                flowAnalytics.getHistoricalResourceUsage(flowId, type);
                
            if (history.size() < 2) {
                trends.put(type, 0.0);
                continue;
            }
            
            SimpleRegression regression = new SimpleRegression();
            history.forEach(point -> 
                regression.addData(point.getTimestamp().toEpochSecond(java.time.ZoneOffset.UTC), 
                                 point.getUsage()));
                                 
            // 计算趋势强度（0-1之间）
            double trend = regression.getSlope() > 0 ? 
                Math.min(regression.getRSquare() * regression.getSlope(), 1.0) : 0.0;
            trends.put(type, trend);
        }
        
        return trends;
    }
} 