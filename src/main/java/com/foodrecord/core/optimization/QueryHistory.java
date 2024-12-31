package com.foodrecord.core.optimization;

import java.util.*;

public class QueryHistory {
    private List<QueryOptimizationReport.SlowQuery> slowQueries;
    private IndexUsageAnalysis indexAnalysis;
    private Map<String, QueryHistoryAnalyzer.QueryPattern> queryPatterns;
    private Map<String, List<ExecutionTimePoint>> executionTimeHistory;
    private Map<String, List<ResourceUsagePoint>> resourceUsageHistory;

    public QueryHistory() {
        this.slowQueries = new ArrayList<>();
        this.queryPatterns = new HashMap<>();
        this.executionTimeHistory = new HashMap<>();
        this.resourceUsageHistory = new HashMap<>();
    }

    public void setSlowQueries(List<QueryOptimizationReport.SlowQuery> slowQueries) {
        this.slowQueries = slowQueries;
    }

    public void setIndexAnalysis(IndexUsageAnalysis indexAnalysis) {
        this.indexAnalysis = indexAnalysis;
    }

    public void setQueryPatterns(Map<String, QueryHistoryAnalyzer.QueryPattern> queryPatterns) {
        this.queryPatterns = queryPatterns;
    }

    public void addExecutionTimePoint(String queryId, ExecutionTimePoint point) {
        executionTimeHistory.computeIfAbsent(queryId, k -> new ArrayList<>()).add(point);
    }

    public void addResourceUsagePoint(String queryId, ResourceUsagePoint point) {
        resourceUsageHistory.computeIfAbsent(queryId, k -> new ArrayList<>()).add(point);
    }

    public List<QueryOptimizationReport.SlowQuery> getSlowQueries() {
        return slowQueries;
    }

    public IndexUsageAnalysis getIndexAnalysis() {
        return indexAnalysis;
    }

    public Map<String, QueryHistoryAnalyzer.QueryPattern> getQueryPatterns() {
        return queryPatterns;
    }

    public List<ExecutionTimePoint> getExecutionTimeHistory(String queryId) {
        return executionTimeHistory.getOrDefault(queryId, new ArrayList<>());
    }

    public List<ResourceUsagePoint> getResourceUsageHistory(String queryId) {
        return resourceUsageHistory.getOrDefault(queryId, new ArrayList<>());
    }

    public Map<String, List<ExecutionTimePoint>> getAllExecutionTimeHistory() {
        return executionTimeHistory;
    }

    public Map<String, List<ResourceUsagePoint>> getAllResourceUsageHistory() {
        return resourceUsageHistory;
    }

    public void cleanOldHistory(long retentionPeriod) {
        long cutoffTime = System.currentTimeMillis() - retentionPeriod;
        
        for (List<ExecutionTimePoint> points : executionTimeHistory.values()) {
            points.removeIf(point -> point.getTimestamp() < cutoffTime);
        }
        
        for (List<ResourceUsagePoint> points : resourceUsageHistory.values()) {
            points.removeIf(point -> point.getTimestamp() < cutoffTime);
        }
        
        // 移除空的历史记录
        executionTimeHistory.values().removeIf(List::isEmpty);
        resourceUsageHistory.values().removeIf(List::isEmpty);
    }

    public void addQueryPattern(String pattern, QueryHistoryAnalyzer.QueryPattern queryPattern) {
        queryPatterns.put(pattern, queryPattern);
    }

    public QueryHistoryAnalyzer.QueryPattern getQueryPattern(String pattern) {
        return queryPatterns.get(pattern);
    }

    public boolean hasQueryPattern(String pattern) {
        return queryPatterns.containsKey(pattern);
    }

    public Set<String> getUniquePatterns() {
        return queryPatterns.keySet();
    }

    public int getTotalQueryCount() {
        return queryPatterns.values().stream()
                .mapToInt(QueryHistoryAnalyzer.QueryPattern::getFrequency)
                .sum();
    }
} 