package com.foodrecord.core.optimization;

import java.util.*;

public class QueryOptimizationReport {
    private List<SlowQuery> slowQueries;
    private IndexAnalysis indexAnalysis;
    private List<QueryPlan> optimizedPlans;
    private List<CostModelOptimizer.OptimizationSuggestion> suggestions;
    private Map<String, PerformanceMetrics> queryMetrics;
    private long generationTimestamp;

    public QueryOptimizationReport() {
        this.slowQueries = new ArrayList<>();
        this.optimizedPlans = new ArrayList<>();
        this.suggestions = new ArrayList<>();
        this.queryMetrics = new HashMap<>();
        this.generationTimestamp = System.currentTimeMillis();
    }

    public QueryOptimizationReport(List<CostModelOptimizer.OptimizationSuggestion> suggestions) {
        this();
        this.suggestions = new ArrayList<>(suggestions);
    }

    public void setSlowQueries(List<SlowQuery> slowQueries) {
        this.slowQueries = slowQueries;
    }

    public void addOptimizedPlan(QueryPlan plan) {
        this.optimizedPlans.add(plan);
    }

    public void setSuggestions(List<CostModelOptimizer.OptimizationSuggestion> suggestions) {
        this.suggestions = suggestions;
    }

    public void addSuggestion(CostModelOptimizer.OptimizationSuggestion suggestion) {
        this.suggestions.add(suggestion);
    }

    public void setIndexAnalysis(IndexAnalysis analysis) {
        this.indexAnalysis = analysis;
    }

    public void addQueryMetrics(String queryId, PerformanceMetrics metrics) {
        this.queryMetrics.put(queryId, metrics);
    }

    public List<SlowQuery> getSlowQueries() {
        return slowQueries;
    }

    public IndexAnalysis getIndexAnalysis() {
        return indexAnalysis;
    }

    public List<QueryPlan> getOptimizedPlans() {
        return optimizedPlans;
    }

    public List<CostModelOptimizer.OptimizationSuggestion> getSuggestions() {
        return suggestions;
    }

    public Map<String, PerformanceMetrics> getQueryMetrics() {
        return queryMetrics;
    }

    public long getGenerationTimestamp() {
        return generationTimestamp;
    }

    public static class SlowQuery {
        private String sql;
        private long executionTime;
        private int frequency;
        private Set<String> usedIndexes;
        private String explanation;

        public SlowQuery(String sql, long executionTime, int frequency) {
            this.sql = sql;
            this.executionTime = executionTime;
            this.frequency = frequency;
            this.usedIndexes = new HashSet<>();
        }

        public String getSql() {
            return sql;
        }

        public long getExecutionTime() {
            return executionTime;
        }

        public int getFrequency() {
            return frequency;
        }

        public Set<String> getUsedIndexes() {
            return usedIndexes;
        }

        public String getExplanation() {
            return explanation;
        }

        public void setExplanation(String explanation) {
            this.explanation = explanation;
        }

        public void addUsedIndex(String index) {
            usedIndexes.add(index);
        }
    }

    public static class IndexAnalysis {
        private Map<String, Integer> indexUsageCount = new HashMap<>();
        private List<String> unusedIndexes = new ArrayList<>();
        private List<String> suggestedIndexes = new ArrayList<>();

        public void incrementIndexUsage(String index) {
            indexUsageCount.merge(index, 1, Integer::sum);
        }

        public void addUnusedIndex(String index) {
            unusedIndexes.add(index);
        }

        public void addSuggestedIndex(String index) {
            suggestedIndexes.add(index);
        }

        public Map<String, Integer> getIndexUsageCount() {
            return indexUsageCount;
        }

        public List<String> getUnusedIndexes() {
            return unusedIndexes;
        }

        public List<String> getSuggestedIndexes() {
            return suggestedIndexes;
        }
    }

    public static class PerformanceMetrics {
        private double averageExecutionTime;
        private int totalExecutions;
        private double successRate;
        private Map<String, Double> resourceUtilization = new HashMap<>();

        public void setAverageExecutionTime(double averageExecutionTime) {
            this.averageExecutionTime = averageExecutionTime;
        }

        public void setTotalExecutions(int totalExecutions) {
            this.totalExecutions = totalExecutions;
        }

        public void setSuccessRate(double successRate) {
            this.successRate = successRate;
        }

        public void addResourceUtilization(String resource, double utilization) {
            resourceUtilization.put(resource, utilization);
        }

        public double getAverageExecutionTime() {
            return averageExecutionTime;
        }

        public int getTotalExecutions() {
            return totalExecutions;
        }

        public double getSuccessRate() {
            return successRate;
        }

        public Map<String, Double> getResourceUtilization() {
            return resourceUtilization;
        }
    }
} 