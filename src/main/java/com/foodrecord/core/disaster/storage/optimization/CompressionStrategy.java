package com.foodrecord.core.disaster.storage.optimization;

public class CompressionStrategy {
    private final String algorithm;
    private final int level;
    private final boolean parallel;

    public CompressionStrategy(String algorithm, int level, boolean parallel) {
        this.algorithm = algorithm;
        this.level = level;
        this.parallel = parallel;
    }

    public String getAlgorithm() {
        return algorithm;
    }

    public int getLevel() {
        return level;
    }

    public boolean isParallel() {
        return parallel;
    }
} 