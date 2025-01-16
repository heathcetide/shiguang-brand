// TODO ml - module
//package com.foodrecord.ml.data;
//
//import org.nd4j.linalg.api.ndarray.INDArray;
//import org.nd4j.linalg.factory.Nd4j;
//import org.nd4j.linalg.indexing.NDArrayIndex;
//
//
//public class MLDataSet {
//    private INDArray features;
//    private INDArray labels;
//
//    public MLDataSet[] split(double validationSplit, boolean randomize) {
//        int totalSamples = (int) features.size(0);
//        int trainSize = (int) (totalSamples * (1 - validationSplit));
//
//        INDArray indices = Nd4j.arange(totalSamples);
//        if (randomize) {
//            Nd4j.shuffle(indices); // 随机打乱索引
//        }
//
//        INDArray trainIndices = indices.get(NDArrayIndex.interval(0, trainSize));
//        INDArray validIndices = indices.get(NDArrayIndex.interval(trainSize, totalSamples));
//
//        INDArray trainFeatures = features.getRows(trainIndices.toIntVector());
//        INDArray trainLabels = labels.getRows(trainIndices.toIntVector());
//        INDArray validFeatures = features.getRows(validIndices.toIntVector());
//        INDArray validLabels = labels.getRows(validIndices.toIntVector());
//
//        MLDataSet trainSet = new MLDataSet();
//        trainSet.setFeatures(trainFeatures);
//        trainSet.setLabels(trainLabels);
//
//        MLDataSet validSet = new MLDataSet();
//        validSet.setFeatures(validFeatures);
//        validSet.setLabels(validLabels);
//
//        return new MLDataSet[]{trainSet, validSet};
//    }
//
//    public MLDataSet[] splitTimeSeries(double validationSplit) {
//        int totalSamples = (int) features.size(0);
//        int trainSize = (int) (totalSamples * (1 - validationSplit));
//
//        INDArray trainFeatures = features.getRows(0, trainSize);
//        INDArray trainLabels = labels.getRows(0, trainSize);
//
//        INDArray validFeatures = features.getRows(trainSize, totalSamples);
//        INDArray validLabels = labels.getRows(trainSize, totalSamples);
//
//        MLDataSet trainSet = new MLDataSet();
//        trainSet.setFeatures(trainFeatures);
//        trainSet.setLabels(trainLabels);
//
//        MLDataSet validSet = new MLDataSet();
//        validSet.setFeatures(validFeatures);
//        validSet.setLabels(validLabels);
//
//        return new MLDataSet[]{trainSet, validSet};
//    }
//
//
//    public INDArray getFeatures() {
//        return features;
//    }
//
//    public void setFeatures(INDArray features) {
//        this.features = features;
//    }
//
//    public INDArray getLabels() {
//        return labels;
//    }
//
//    public void setLabels(INDArray labels) {
//        this.labels = labels;
//    }
//}