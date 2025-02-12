package com.foodrecord.common.risk.metrics;

import com.foodrecord.risk.enums.RiskLevel;
import com.foodrecord.risk.model.RiskEvent;
import com.foodrecord.risk.model.RiskMetrics;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

//@Component
public class RiskMetricsCalculator {

    /**
     * 计算风险指标
     */
    public RiskMetrics calculate(List<RiskEvent> events) {
        RiskMetrics metrics = new RiskMetrics();
        
        // 1. 基础统计
        metrics.setTotalEvents(events.size());
        
        // 2. 事件类型统计
        Map<String, Long> eventCounts = events.stream()
            .collect(Collectors.groupingBy(
                e -> e.getContext().getScenario(),
                Collectors.counting()
            ));
        metrics.setEventCounts(eventCounts);
        
        // 3. 风险分数统计
        Map<String, Double> riskScores = events.stream()
            .collect(Collectors.groupingBy(
                e -> e.getContext().getScenario(),
                Collectors.averagingDouble(RiskEvent::getScore)
            ));
        metrics.setRiskScores(riskScores);
        
        // 4. 平均风险分数
        double avgScore = events.stream()
            .mapToDouble(RiskEvent::getScore)
            .average()
            .orElse(0.0);
        metrics.setAvgRiskScore(avgScore);
        
        // 5. 风险等级统计
        metrics.setHighRiskCount(countByRiskLevel(events, RiskLevel.HIGH));
        metrics.setMediumRiskCount(countByRiskLevel(events, RiskLevel.MEDIUM));
        metrics.setLowRiskCount(countByRiskLevel(events, RiskLevel.LOW));
        
        return metrics;
    }
    
    private long countByRiskLevel(List<RiskEvent> events, RiskLevel level) {
        return events.stream()
            .filter(e -> e.getLevel() == level)
            .count();
    }
} 