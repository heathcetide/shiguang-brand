package com.foodrecord.core.disaster.storage.analysis;

public class CompressionAnalysis {
    private final double compressionRatio;
    private final boolean isCompressible;
    private final String recommendedAlgorithm;

    public CompressionAnalysis(double compressionRatio, boolean isCompressible, String recommendedAlgorithm) {
        this.compressionRatio = compressionRatio;
        this.isCompressible = isCompressible;
        this.recommendedAlgorithm = recommendedAlgorithm;
    }

    public double getCompressionRatio() {
        return compressionRatio;
    }

    public boolean isCompressible() {
        return isCompressible;
    }

    public String getRecommendedAlgorithm() {
        return recommendedAlgorithm;
    }
}
