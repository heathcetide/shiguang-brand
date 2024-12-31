package com.foodrecord.core.disaster.storage.analysis;

public class StorageEfficiencyMetrics {
    private final double spaceUtilization;
    private final double iOEfficiency;
    private final double costEfficiency;

    public StorageEfficiencyMetrics(double spaceUtilization, double iOEfficiency, double costEfficiency) {
        this.spaceUtilization = spaceUtilization;
        this.iOEfficiency = iOEfficiency;
        this.costEfficiency = costEfficiency;
    }

    public double getSpaceUtilization() {
        return spaceUtilization;
    }

    public double getIOEfficiency() {
        return iOEfficiency;
    }

    public double getCostEfficiency() {
        return costEfficiency;
    }
}
