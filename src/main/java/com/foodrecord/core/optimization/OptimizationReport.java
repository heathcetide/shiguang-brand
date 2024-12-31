package com.foodrecord.core.optimization;

import java.util.*;

public class OptimizationReport {
    private CacheAnalysis cacheAnalysis;
    private QueryAnalysis queryAnalysis;
    private ThreadPoolAnalysis threadPoolAnalysis;

    public OptimizationReport() {
        this.cacheAnalysis = new CacheAnalysis();
        this.queryAnalysis = new QueryAnalysis();
        this.threadPoolAnalysis = new ThreadPoolAnalysis();
    }

    public void setCacheAnalysis(CacheAnalysis cacheAnalysis) {
        this.cacheAnalysis = cacheAnalysis;
    }

    public CacheAnalysis getCacheAnalysis() {
        return cacheAnalysis;
    }

    public void setQueryAnalysis(QueryAnalysis queryAnalysis) {
        this.queryAnalysis = queryAnalysis;
    }

    public QueryAnalysis getQueryAnalysis() {
        return queryAnalysis;
    }

    public void setThreadPoolAnalysis(ThreadPoolAnalysis threadPoolAnalysis) {
        this.threadPoolAnalysis = threadPoolAnalysis;
    }

    public ThreadPoolAnalysis getThreadPoolAnalysis() {
        return threadPoolAnalysis;
    }

    public static class CacheAnalysis {
        private double hitRate;
        private long size;
        private long evictions;
        private Map<String, Double> metrics;

        public CacheAnalysis() {
            this.metrics = new HashMap<>();
        }

        public void setHitRate(double hitRate) {
            this.hitRate = hitRate;
        }

        public double getHitRate() {
            return hitRate;
        }

        public void setSize(long size) {
            this.size = size;
        }

        public long getSize() {
            return size;
        }

        public void setEvictions(long evictions) {
            this.evictions = evictions;
        }

        public long getEvictions() {
            return evictions;
        }

        public void addCacheMetric(String name, double value) {
            metrics.put(name, value);
        }

        public Map<String, Double> getMetrics() {
            return Collections.unmodifiableMap(metrics);
        }

        public boolean requiresOptimization() {
            return hitRate < 0.8 || evictions > 1000;
        }
    }

    public static class QueryAnalysis {
        private List<QueryOptimizationReport.SlowQuery> slowQueries;
        private List<String> suggestions;
        private Map<String, Double> metrics;

        public QueryAnalysis() {
            this.slowQueries = new ArrayList<>();
            this.suggestions = new ArrayList<>();
            this.metrics = new HashMap<>();
        }

        public void setSlowQueries(List<QueryOptimizationReport.SlowQuery> slowQueries) {
            this.slowQueries = new ArrayList<>(slowQueries);
        }

        public List<QueryOptimizationReport.SlowQuery> getSlowQueries() {
            return Collections.unmodifiableList(slowQueries);
        }

        public void setSuggestions(List<String> suggestions) {
            this.suggestions = new ArrayList<>(suggestions);
        }

        public List<String> getSuggestions() {
            return Collections.unmodifiableList(suggestions);
        }

        public void addQueryMetric(String name, double value) {
            metrics.put(name, value);
        }

        public Map<String, Double> getMetrics() {
            return Collections.unmodifiableMap(metrics);
        }

        public boolean requiresOptimization() {
            return !slowQueries.isEmpty() || metrics.values().stream().anyMatch(value -> value > 1000);
        }

        public void addSlowQuery(QueryOptimizationReport.SlowQuery query) {
            slowQueries.add(query);
        }

        public void addSuggestion(String suggestion) {
            suggestions.add(suggestion);
        }
    }

    public static class ThreadPoolAnalysis {
        private double utilization;
        private long queueSize;
        private long rejections;
        private Map<String, Double> metrics;

        public ThreadPoolAnalysis() {
            this.metrics = new HashMap<>();
        }

        public void setUtilization(double utilization) {
            this.utilization = utilization;
        }

        public double getUtilization() {
            return utilization;
        }

        public void setQueueSize(long queueSize) {
            this.queueSize = queueSize;
        }

        public long getQueueSize() {
            return queueSize;
        }

        public void setRejections(long rejections) {
            this.rejections = rejections;
        }

        public long getRejections() {
            return rejections;
        }

        public void addThreadPoolMetric(String name, double value) {
            metrics.put(name, value);
        }

        public Map<String, Double> getMetrics() {
            return Collections.unmodifiableMap(metrics);
        }

        public boolean requiresOptimization() {
            return utilization > 0.8 || queueSize > 100 || rejections > 0;
        }
    }
} 