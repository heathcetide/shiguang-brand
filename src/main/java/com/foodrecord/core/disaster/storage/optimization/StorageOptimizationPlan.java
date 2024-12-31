package com.foodrecord.core.disaster.storage.optimization;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class StorageOptimizationPlan {
    private CompressionStrategy compressionStrategy;
    private DedupStrategy dedupStrategy;
    private final List<OptimizationStep> steps;
    private final Map<String, Double> expectedSavings;

    public StorageOptimizationPlan() {
        this.steps = new ArrayList<>();
        this.expectedSavings = new HashMap<>();
    }

    public void setCompressionStrategy(CompressionStrategy strategy) {
        this.compressionStrategy = strategy;
        this.steps.add(OptimizationStep.COMPRESS_DATA);
    }

    public void setDedupStrategy(DedupStrategy strategy) {
        this.dedupStrategy = strategy;
        this.steps.add(OptimizationStep.DEDUPLICATE_DATA);
    }

    public CompressionStrategy getCompressionStrategy() {
        return compressionStrategy;
    }

    public DedupStrategy getDedupStrategy() {
        return dedupStrategy;
    }

    public List<OptimizationStep> getSteps() {
        return steps;
    }

    public Map<String, Double> getExpectedSavings() {
        return expectedSavings;
    }

    public void addExpectedSaving(String category, double saving) {
        expectedSavings.put(category, saving);
    }
} 