package com.foodrecord.core.optimization;

import java.util.*;

public class CostModel {
    private Map<String, Double> queryWeights;
    private Map<String, Double> resourceWeights;
    private Map<String, Double> indexWeights;
    private double totalCost;

    public CostModel() {
        this.queryWeights = new HashMap<>();
        this.resourceWeights = new HashMap<>();
        this.indexWeights = new HashMap<>();
        this.totalCost = 0.0;
    }

    public void addQueryWeight(String queryId, double weight) {
        queryWeights.put(queryId, weight);
        recalculateTotalCost();
    }

    public void addResourceWeight(String resource, double weight) {
        resourceWeights.put(resource, weight);
        recalculateTotalCost();
    }

    public void addIndexWeight(String index, double weight) {
        indexWeights.put(index, weight);
        recalculateTotalCost();
    }

    public double getQueryWeight(String queryId) {
        return queryWeights.getOrDefault(queryId, 0.0);
    }

    public double getResourceWeight(String resource) {
        return resourceWeights.getOrDefault(resource, 0.0);
    }

    public double getIndexWeight(String index) {
        return indexWeights.getOrDefault(index, 0.0);
    }

    public double getTotalCost() {
        return totalCost;
    }

    private void recalculateTotalCost() {
        this.totalCost = queryWeights.values().stream().mapToDouble(Double::doubleValue).sum() +
                        resourceWeights.values().stream().mapToDouble(Double::doubleValue).sum() +
                        indexWeights.values().stream().mapToDouble(Double::doubleValue).sum();
    }

    public Map<String, Double> getQueryWeights() {
        return new HashMap<>(queryWeights);
    }

    public Map<String, Double> getResourceWeights() {
        return new HashMap<>(resourceWeights);
    }

    public Map<String, Double> getIndexWeights() {
        return new HashMap<>(indexWeights);
    }

    public void optimize() {
        // 优化权重分配
        normalizeWeights(queryWeights);
        normalizeWeights(resourceWeights);
        normalizeWeights(indexWeights);
        recalculateTotalCost();
    }

    private void normalizeWeights(Map<String, Double> weights) {
        double sum = weights.values().stream().mapToDouble(Double::doubleValue).sum();
        if (sum > 0) {
            weights.replaceAll((k, v) -> v / sum);
        }
    }
}