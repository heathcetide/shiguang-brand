package com.foodrecord.core.optimization;

import java.util.ArrayList;
import java.util.List;

public class OptimizedPlan {
    private String originalSql;
    private String optimizedSql;
    private List<CostModelOptimizer.OptimizationSuggestion> suggestions;
    private double estimatedCost;
    private long timestamp;
    private String explanation;

    public OptimizedPlan() {
        this.suggestions = new ArrayList<>();
        this.timestamp = System.currentTimeMillis();
    }

    public String getOriginalSql() {
        return originalSql;
    }

    public void setOriginalSql(String originalSql) {
        this.originalSql = originalSql;
    }

    public String getOptimizedSql() {
        return optimizedSql;
    }

    public void setOptimizedSql(String optimizedSql) {
        this.optimizedSql = optimizedSql;
    }

    public List<CostModelOptimizer.OptimizationSuggestion> getSuggestions() {
        return suggestions;
    }

    public void setSuggestions(List<CostModelOptimizer.OptimizationSuggestion> suggestions) {
        this.suggestions = suggestions;
    }

    public double getEstimatedCost() {
        return estimatedCost;
    }

    public void setEstimatedCost(double estimatedCost) {
        this.estimatedCost = estimatedCost;
    }

    public long getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(long timestamp) {
        this.timestamp = timestamp;
    }

    public String getExplanation() {
        return explanation;
    }

    public void setExplanation(String explanation) {
        this.explanation = explanation;
    }

    public void addSuggestion(CostModelOptimizer.OptimizationSuggestion suggestion) {
        this.suggestions.add(suggestion);
    }

    public boolean hasOptimizations() {
        return !originalSql.equals(optimizedSql);
    }

    public double getEstimatedImprovement() {
        return suggestions.stream()
                .mapToDouble(CostModelOptimizer.OptimizationSuggestion::getExpectedImprovement)
                .sum();
    }
} 