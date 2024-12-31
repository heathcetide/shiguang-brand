package com.foodrecord.core.disaster.storage.analysis;

public class DataDistributionAnalysis {
    private final double dataSkewness;
    private final double dataDensity;
    private final boolean hasHotspots;

    public DataDistributionAnalysis(double dataSkewness, double dataDensity, boolean hasHotspots) {
        this.dataSkewness = dataSkewness;
        this.dataDensity = dataDensity;
        this.hasHotspots = hasHotspots;
    }

    public double getDataSkewness() {
        return dataSkewness;
    }

    public double getDataDensity() {
        return dataDensity;
    }

    public boolean hasHotspots() {
        return hasHotspots;
    }
}

