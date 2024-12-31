package com.foodrecord.core.disaster.storage.analysis;

public class DuplicationAnalysis {
    private final double duplicationRate;
    private final boolean hasDuplicateData;
    private final long duplicateBlockCount;

    public DuplicationAnalysis(double duplicationRate, boolean hasDuplicateData, long duplicateBlockCount) {
        this.duplicationRate = duplicationRate;
        this.hasDuplicateData = hasDuplicateData;
        this.duplicateBlockCount = duplicateBlockCount;
    }

    public double getDuplicationRate() {
        return duplicationRate;
    }

    public boolean hasDuplicateData() {
        return hasDuplicateData;
    }

    public long getDuplicateBlockCount() {
        return duplicateBlockCount;
    }
}
