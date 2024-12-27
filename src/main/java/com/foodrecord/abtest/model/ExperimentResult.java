package com.foodrecord.abtest.model;

import java.util.Map;

public class ExperimentResult {
    private String experimentId;
    private Map<String, VariantResult> variantResults;
    private String winningVariant;
    private double confidenceLevel;
    private boolean significant;
    private long sampleSize;
    private long duration;

    public static class VariantResult {
        private long sampleSize;
        private Map<String, Double> metrics;
        private Map<String, Double> improvements;
        private Map<String, Double> pValues;

        // Getters and setters
        public long getSampleSize() {
            return sampleSize;
        }

        public void setSampleSize(long sampleSize) {
            this.sampleSize = sampleSize;
        }

        public Map<String, Double> getMetrics() {
            return metrics;
        }

        public void setMetrics(Map<String, Double> metrics) {
            this.metrics = metrics;
        }

        public Map<String, Double> getImprovements() {
            return improvements;
        }

        public void setImprovements(Map<String, Double> improvements) {
            this.improvements = improvements;
        }

        public Map<String, Double> getPValues() {
            return pValues;
        }

        public void setPValues(Map<String, Double> pValues) {
            this.pValues = pValues;
        }
    }

    // Getters and setters
    public String getExperimentId() {
        return experimentId;
    }

    public void setExperimentId(String experimentId) {
        this.experimentId = experimentId;
    }

    public Map<String, VariantResult> getVariantResults() {
        return variantResults;
    }

    public void setVariantResults(Map<String, VariantResult> variantResults) {
        this.variantResults = variantResults;
    }

    public String getWinningVariant() {
        return winningVariant;
    }

    public void setWinningVariant(String winningVariant) {
        this.winningVariant = winningVariant;
    }

    public double getConfidenceLevel() {
        return confidenceLevel;
    }

    public void setConfidenceLevel(double confidenceLevel) {
        this.confidenceLevel = confidenceLevel;
    }

    public boolean isSignificant() {
        return significant;
    }

    public void setSignificant(boolean significant) {
        this.significant = significant;
    }

    public long getSampleSize() {
        return sampleSize;
    }

    public void setSampleSize(long sampleSize) {
        this.sampleSize = sampleSize;
    }

    public long getDuration() {
        return duration;
    }

    public void setDuration(long duration) {
        this.duration = duration;
    }
} 