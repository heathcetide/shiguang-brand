package com.foodrecord.core.disaster.storage.optimization;

public class DedupStrategy {
    private final int blockSize;
    private final String hashAlgorithm;
    private final boolean inlineDedup;

    public DedupStrategy(int blockSize, String hashAlgorithm, boolean inlineDedup) {
        this.blockSize = blockSize;
        this.hashAlgorithm = hashAlgorithm;
        this.inlineDedup = inlineDedup;
    }

    public int getBlockSize() {
        return blockSize;
    }

    public String getHashAlgorithm() {
        return hashAlgorithm;
    }

    public boolean isInlineDedup() {
        return inlineDedup;
    }
} 