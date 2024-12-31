package com.foodrecord.core.disaster.storage.optimization;

import com.foodrecord.core.disaster.storage.analysis.*;

public class StorageCharacteristics {
    private final DataDistributionAnalysis distribution;
    private final CompressionAnalysis compression;
    private final DuplicationAnalysis duplication;
    private final StorageEfficiencyMetrics efficiency;

    public StorageCharacteristics(
            DataDistributionAnalysis distribution,
            CompressionAnalysis compression,
            DuplicationAnalysis duplication,
            StorageEfficiencyMetrics efficiency) {
        this.distribution = distribution;
        this.compression = compression;
        this.duplication = duplication;
        this.efficiency = efficiency;
    }

    public boolean isCompressible() {
        return compression.isCompressible();
    }

    public boolean hasDuplicateData() {
        return duplication.hasDuplicateData();
    }

    public DataDistributionAnalysis getDistribution() {
        return distribution;
    }

    public CompressionAnalysis getCompression() {
        return compression;
    }

    public DuplicationAnalysis getDuplication() {
        return duplication;
    }

    public StorageEfficiencyMetrics getEfficiency() {
        return efficiency;
    }
} 