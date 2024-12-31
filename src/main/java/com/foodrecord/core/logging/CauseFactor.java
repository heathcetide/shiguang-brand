package com.foodrecord.core.logging;

import java.util.List;
import java.util.Map;

public class CauseFactor {
    private final String factorType;
    private final String description;
    private final double probability;
    private final List<String> evidence;
    private final Map<String, Object> metadata;

    public CauseFactor(String factorType, String description, double probability,
                      List<String> evidence, Map<String, Object> metadata) {
        this.factorType = factorType;
        this.description = description;
        this.probability = probability;
        this.evidence = evidence;
        this.metadata = metadata;
    }

    public String getFactorType() {
        return factorType;
    }

    public String getDescription() {
        return description;
    }

    public double getProbability() {
        return probability;
    }

    public List<String> getEvidence() {
        return evidence;
    }

    public Map<String, Object> getMetadata() {
        return metadata;
    }
} 