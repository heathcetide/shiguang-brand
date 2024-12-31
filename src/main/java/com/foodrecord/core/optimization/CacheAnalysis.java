package com.foodrecord.core.optimization;

import java.util.*;

public class CacheAnalysis {
    private final List<CacheSuggestion> suggestions;
    private final Map<String, Double> metrics;

    public CacheAnalysis() {
        this.suggestions = new ArrayList<>();
        this.metrics = new HashMap<>();
    }

    public void addSuggestion(CacheSuggestion suggestion) {
        suggestions.add(suggestion);
    }

    public List<CacheSuggestion> getSuggestions() {
        return Collections.unmodifiableList(suggestions);
    }

    public void addMetric(String name, double value) {
        metrics.put(name, value);
    }

    public Map<String, Double> getMetrics() {
        return Collections.unmodifiableMap(metrics);
    }

    public boolean requiresOptimization() {
        return !suggestions.isEmpty();
    }
} 