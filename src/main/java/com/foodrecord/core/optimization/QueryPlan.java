package com.foodrecord.core.optimization;

import java.util.*;

public class QueryPlan {
    private String originalSql;
    private String optimizedSql;
    private double estimatedCost;
    private List<String> optimizations;
    private long timestamp;

    public QueryPlan(String sql) {
        this.originalSql = sql;
        this.optimizedSql = sql;
        this.optimizations = new ArrayList<>();
        this.timestamp = System.currentTimeMillis();
    }

    public String getOriginalSql() {
        return originalSql;
    }

    public String getOptimizedSql() {
        return optimizedSql;
    }

    public void setOptimizedSql(String optimizedSql) {
        this.optimizedSql = optimizedSql;
    }

    public double getEstimatedCost() {
        return estimatedCost;
    }

    public void setEstimatedCost(double estimatedCost) {
        this.estimatedCost = estimatedCost;
    }

    public void addOptimization(String optimization) {
        optimizations.add(optimization);
    }

    public List<String> getOptimizations() {
        return Collections.unmodifiableList(optimizations);
    }

    public boolean hasOptimizations() {
        return !optimizations.isEmpty();
    }

    public long getTimestamp() {
        return timestamp;
    }
} 