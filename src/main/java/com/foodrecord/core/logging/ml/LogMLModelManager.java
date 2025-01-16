// TODO ml - module
//package com.foodrecord.core.logging.ml;
//
//import com.foodrecord.ml.evaluation.ModelEvaluator;
//import com.foodrecord.ml.feature.FeatureExtractor;
//import org.nd4j.evaluation.classification.ConfusionMatrix;
//import org.springframework.stereotype.Component;
//import org.deeplearning4j.nn.multilayer.MultiLayerNetwork;
//
//import java.util.List;
//import java.util.Map;
//import java.util.HashMap;
//
//@Component
//public class LogMLModelManager {
//    private final ModelTrainer modelTrainer;
//    private final FeatureExtractor featureExtractor;
//    private final ModelEvaluator modelEvaluator;
//    private Map<String, Object> modelMetadata;
//    private static final double IMPROVEMENT_THRESHOLD = 0.05;
//
//    public LogMLModelManager(ModelTrainer modelTrainer, FeatureExtractor featureExtractor, ModelEvaluator modelEvaluator) {
//        this.modelTrainer = modelTrainer;
//        this.featureExtractor = featureExtractor;
//        this.modelEvaluator = modelEvaluator;
//        this.modelMetadata = new HashMap<>();
//    }
//
//    public void updateModels(List<LogEntry> newLogs) {
//        // 1. 特征提取
//        List<FeatureVector> features =
//            featureExtractor.extractFeatures(newLogs);
//
//        // 2. 增量训练
//        ModelUpdateResult result = modelTrainer.incrementalTrain(features);
//
//        // 3. 评估模型性能
//        ModelPerformance performance =
//            modelEvaluator.evaluate(result.getUpdatedModel());
//
//        // 4. 决定是否应用更新
//        if (shouldApplyUpdate(performance)) {
//            applyModelUpdate(result);
//            updateModelMetadata(performance);
//        }
//    }
//
//    protected boolean shouldApplyUpdate(ModelPerformance performance) {
//        // 检查性能指标是否达到更新阈值
//        double currentAccuracy = (double) modelMetadata.getOrDefault("accuracy", 0.0);
//        return performance.getAccuracy() > currentAccuracy + IMPROVEMENT_THRESHOLD;
//    }
//
//    protected void applyModelUpdate(ModelUpdateResult result) {
//        // 应用模型更新
//        modelMetadata.put("lastUpdateTime", System.currentTimeMillis());
//        modelMetadata.put("improvementRate", result.getImprovementRate());
//        modelMetadata.put("significantChanges", result.getSignificantChanges());
//        modelMetadata.put("featureImportance", result.getFeatureImportance());
//    }
//
//    protected void updateModelMetadata(ModelPerformance performance) {
//        // 更新模型元数据
//        modelMetadata.put("accuracy", performance.getAccuracy());
//        modelMetadata.put("precision", performance.getPrecision());
//        modelMetadata.put("recall", performance.getRecall());
//        modelMetadata.put("f1Score", performance.getF1Score());
//        modelMetadata.put("classSpecificMetrics", performance.getClassSpecificMetrics());
//        modelMetadata.put("confusionMatrix", performance.getConfusionMatrix());
//    }
//
//    public Map<String, Object> getModelMetadata() {
//        return new HashMap<>(modelMetadata);
//    }
//
//    public static class ModelPerformance {
//        private final double accuracy;
//        private final double precision;
//        private final double recall;
//        private final double f1Score;
//        private final Map<String, Double> classSpecificMetrics;
//        private final ConfusionMatrix confusionMatrix;
//
//        public ModelPerformance(double accuracy, double precision, double recall, double f1Score, Map<String, Double> classSpecificMetrics, ConfusionMatrix confusionMatrix) {
//            this.accuracy = accuracy;
//            this.precision = precision;
//            this.recall = recall;
//            this.f1Score = f1Score;
//            this.classSpecificMetrics = classSpecificMetrics;
//            this.confusionMatrix = confusionMatrix;
//        }
//
//        public double getAccuracy() {
//            return accuracy;
//        }
//
//        public double getPrecision() {
//            return precision;
//        }
//
//        public double getRecall() {
//            return recall;
//        }
//
//        public double getF1Score() {
//            return f1Score;
//        }
//
//        public Map<String, Double> getClassSpecificMetrics() {
//            return classSpecificMetrics;
//        }
//
//        public ConfusionMatrix getConfusionMatrix() {
//            return confusionMatrix;
//        }
//    }
//
//    public static class ModelUpdateResult {
//        private final MultiLayerNetwork updatedModel;
//        private final double improvementRate;
//        private final List<String> significantChanges;
//        private final Map<String, Double> featureImportance;
//
//
//        public ModelUpdateResult(MultiLayerNetwork updatedModel, double improvementRate, List<String> significantChanges, Map<String, Double> featureImportance) {
//            this.updatedModel = updatedModel;
//            this.improvementRate = improvementRate;
//            this.significantChanges = significantChanges;
//            this.featureImportance = featureImportance;
//        }
//
//        public MultiLayerNetwork getUpdatedModel() {
//            return updatedModel;
//        }
//
//        public double getImprovementRate() {
//            return improvementRate;
//        }
//
//        public List<String> getSignificantChanges() {
//            return significantChanges;
//        }
//
//        public Map<String, Double> getFeatureImportance() {
//            return featureImportance;
//        }
//    }
//}