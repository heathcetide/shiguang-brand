//package com.foodrecord.core.logging.ml;
////TODO ml
//import org.nd4j.linalg.api.ndarray.INDArray;
//import org.nd4j.linalg.factory.Nd4j;
//import java.util.Map;
//import java.util.HashMap;
//import java.util.ArrayList;
//import java.util.List;
//
//public class FeatureVector {
//    private Map<String, Double> features;
//    private String label;
//    private List<String> featureNames;
//
//    public FeatureVector() {
//        this.features = new HashMap<>();
//        this.featureNames = new ArrayList<>();
//    }
//
//    public void addFeature(String name, double value) {
//        if (!featureNames.contains(name)) {
//            featureNames.add(name);
//        }
//        features.put(name, value);
//    }
//
//    public double getFeature(String name) {
//        return features.getOrDefault(name, 0.0);
//    }
//
//    public Map<String, Double> getFeatures() {
//        return features;
//    }
//
//    public void setLabel(String label) {
//        this.label = label;
//    }
//
//    public String getLabel() {
//        return label;
//    }
//
//    public int getDimension() {
//        return features.size();
//    }
//
//    public INDArray toArray() {
//        double[] values = new double[featureNames.size()];
//        for (int i = 0; i < featureNames.size(); i++) {
//            values[i] = features.getOrDefault(featureNames.get(i), 0.0);
//        }
//        return Nd4j.create(values);
//    }
//
//    public List<String> getFeatureNames() {
//        return featureNames;
//    }
//}