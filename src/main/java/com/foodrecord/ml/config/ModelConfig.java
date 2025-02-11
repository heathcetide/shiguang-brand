package com.foodrecord.ml.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "ml.model")
public class ModelConfig {
    private int numEpochs = 100;
    private double learningRate = 0.001;
    private int batchSize = 32;
    private int[] hiddenLayers = {128, 64};
    private double dropoutRate = 0.5;
    private String activationFunction = "relu";
    private double validationSplit = 0.2;
    private int seed = 123;
    private int numFactors = 10; // 协同过滤模型的因子数
    private double regularization = 0.01; // 正则化系数

    public int getNumFactors() {
        return numFactors;
    }

    public void setNumFactors(int numFactors) {
        this.numFactors = numFactors;
    }

    public double getRegularization() {
        return regularization;
    }

    public void setRegularization(double regularization) {
        this.regularization = regularization;
    }

    public int getNumEpochs() {
        return numEpochs;
    }

    public void setNumEpochs(int numEpochs) {
        this.numEpochs = numEpochs;
    }

    public double getLearningRate() {
        return learningRate;
    }

    public void setLearningRate(double learningRate) {
        this.learningRate = learningRate;
    }

    public int getBatchSize() {
        return batchSize;
    }

    public void setBatchSize(int batchSize) {
        this.batchSize = batchSize;
    }

    public int[] getHiddenLayers() {
        return hiddenLayers;
    }

    public void setHiddenLayers(int[] hiddenLayers) {
        this.hiddenLayers = hiddenLayers;
    }

    public double getDropoutRate() {
        return dropoutRate;
    }

    public void setDropoutRate(double dropoutRate) {
        this.dropoutRate = dropoutRate;
    }

    public String getActivationFunction() {
        return activationFunction;
    }

    public void setActivationFunction(String activationFunction) {
        this.activationFunction = activationFunction;
    }

    public double getValidationSplit() {
        return validationSplit;
    }

    public void setValidationSplit(double validationSplit) {
        this.validationSplit = validationSplit;
    }

    public int getSeed() {
        return seed;
    }

    public void setSeed(int seed) {
        this.seed = seed;
    }
}