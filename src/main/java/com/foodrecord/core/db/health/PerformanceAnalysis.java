package com.foodrecord.core.db.health;

import java.time.Duration;
import java.util.Map;

public class PerformanceAnalysis {
    private final QueryPerformanceMetrics queryMetrics;
    private final ResourceUtilization resourceUtilization;
    private final Map<String, Double> performanceScores;
    private final PerformanceRecommendation recommendation;

    public PerformanceAnalysis(QueryPerformanceMetrics queryMetrics, 
                              ResourceUtilization resourceUtilization,
                              Map<String, Double> performanceScores,
                              PerformanceRecommendation recommendation) {
        this.queryMetrics = queryMetrics;
        this.resourceUtilization = resourceUtilization;
        this.performanceScores = performanceScores;
        this.recommendation = recommendation;
    }

    public QueryPerformanceMetrics getQueryMetrics() {
        return queryMetrics;
    }

    public ResourceUtilization getResourceUtilization() {
        return resourceUtilization;
    }

    public Map<String, Double> getPerformanceScores() {
        return performanceScores;
    }

    public PerformanceRecommendation getRecommendation() {
        return recommendation;
    }
}

class PerformanceRecommendation {
    private final String recommendation;
    private final double expectedImprovement;
    private final int priority;
    private final Map<String, String> actionItems;

    public PerformanceRecommendation(String recommendation, double expectedImprovement,
                                   int priority, Map<String, String> actionItems) {
        this.recommendation = recommendation;
        this.expectedImprovement = expectedImprovement;
        this.priority = priority;
        this.actionItems = actionItems;
    }

    public String getRecommendation() {
        return recommendation;
    }

    public double getExpectedImprovement() {
        return expectedImprovement;
    }

    public int getPriority() {
        return priority;
    }

    public Map<String, String> getActionItems() {
        return actionItems;
    }
} 