package com.foodrecord.core.optimization;

import java.util.*;

public class IndexUsageAnalysis {
    private List<String> unusedIndexes;
    private List<String> suggestedIndexes;
    private Map<String, Integer> indexUsageCount;
    private Map<String, Double> indexEfficiency;

    public IndexUsageAnalysis() {
        this.unusedIndexes = new ArrayList<>();
        this.suggestedIndexes = new ArrayList<>();
        this.indexUsageCount = new HashMap<>();
        this.indexEfficiency = new HashMap<>();
    }

    public void addUnusedIndex(String indexName) {
        unusedIndexes.add(indexName);
    }

    public void addSuggestedIndex(String indexName) {
        suggestedIndexes.add(indexName);
    }

    public void recordIndexUsage(String indexName, int count) {
        indexUsageCount.put(indexName, count);
    }

    public void recordIndexEfficiency(String indexName, double efficiency) {
        indexEfficiency.put(indexName, efficiency);
    }

    public List<String> getUnusedIndexes() {
        return Collections.unmodifiableList(unusedIndexes);
    }

    public List<String> getSuggestedIndexes() {
        return Collections.unmodifiableList(suggestedIndexes);
    }

    public Map<String, Integer> getIndexUsageCount() {
        return Collections.unmodifiableMap(indexUsageCount);
    }

    public Map<String, Double> getIndexEfficiency() {
        return Collections.unmodifiableMap(indexEfficiency);
    }
} 