package com.foodrecord.ml.evaluation;

import com.foodrecord.core.logging.ml.LogMLModelManager;
import com.foodrecord.ml.entity.UserFoodInteraction;
import org.deeplearning4j.nn.multilayer.MultiLayerNetwork;
import org.nd4j.evaluation.classification.ConfusionMatrix;
import org.nd4j.linalg.api.ndarray.INDArray;
import org.nd4j.linalg.ops.transforms.Transforms;
import org.springframework.stereotype.Component;

import java.util.*;

@Component
public class ModelEvaluator {
    
    public Map<String, Double> evaluateModel(INDArray predictions, INDArray actual) {
        Map<String, Double> metrics = new HashMap<>();
        
        // 计算RMSE (Root Mean Square Error)
        double rmse = calculateRMSE(predictions, actual);
        metrics.put("RMSE", rmse);
        
        // 计算MAE (Mean Absolute Error)
        double mae = calculateMAE(predictions, actual);
        metrics.put("MAE", mae);
        
        // 计算R² (决定系数)
        double r2 = calculateR2(predictions, actual);
        metrics.put("R2", r2);
        
        return metrics;
    }
    
    private double calculateRMSE(INDArray predictions, INDArray actual) {
        INDArray diff = predictions.sub(actual);
        INDArray squared = diff.mul(diff);
        double mse = squared.meanNumber().doubleValue();
        return Math.sqrt(mse);
    }

    private double calculateMAE(INDArray predictions, INDArray actual) {
        INDArray diff = Transforms.abs(predictions.sub(actual)); // 使用 Transforms.abs()
        return diff.meanNumber().doubleValue();
    }
    
    private double calculateR2(INDArray predictions, INDArray actual) {
        double meanActual = actual.meanNumber().doubleValue();
        INDArray totalSS = actual.sub(meanActual).mul(actual.sub(meanActual));
        INDArray residualSS = predictions.sub(actual).mul(predictions.sub(actual));
        return 1 - (residualSS.sumNumber().doubleValue() / totalSS.sumNumber().doubleValue());
    }

    public LogMLModelManager.ModelPerformance evaluate(MultiLayerNetwork model) {
        // 示例数据，实际应该是模型评估过程
        double accuracy = 0.95; // 假设计算出来的准确率
        double precision = 0.92;
        double recall = 0.90;
        double f1Score = 0.91;

        // 构造混淆矩阵（仅示例）
        ConfusionMatrix confusionMatrix = new ConfusionMatrix(Arrays.asList("ClassA", "ClassB"));
        confusionMatrix.add("ClassA", "ClassA");
        confusionMatrix.add("ClassA", "ClassB");

        // 返回模型性能结果
        return new LogMLModelManager.ModelPerformance(
                accuracy,
                precision,
                recall,
                f1Score,
                new HashMap<>(), // 分类特定指标
                confusionMatrix
        );
    }
}