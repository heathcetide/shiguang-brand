package com.foodrecord.ml.evaluation;

import com.foodrecord.ml.entity.UserFoodInteraction;
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

} 