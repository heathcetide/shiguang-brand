package com.foodrecord.abtest.analysis;

import com.foodrecord.abtest.model.ExperimentResult;
import org.apache.commons.math3.stat.inference.TTest;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

@Component
public class StatisticalAnalyzer {

    private final TTest tTest = new TTest();
    private static final double SIGNIFICANCE_LEVEL = 0.05;

    /**
     * 分析实验结果
     */
    public ExperimentResult analyze(Map<String, Map<String, List<Double>>> variantMetrics) {
        ExperimentResult result = new ExperimentResult();
        String controlVariant = "control"; // 假设control是对照组
        
        // 1. 计算每个变体的指标
        for (Map.Entry<String, Map<String, List<Double>>> entry : variantMetrics.entrySet()) {
            String variant = entry.getKey();
            if (variant.equals(controlVariant)) continue;
            
            Map<String, List<Double>> metrics = entry.getValue();
            ExperimentResult.VariantResult variantResult = analyzeVariant(
                metrics,
                variantMetrics.get(controlVariant)
            );
            
            result.getVariantResults().put(variant, variantResult);
        }
        // 2. 确定获胜变体
        determineWinner(result);
        return result;
    }
    
    private ExperimentResult.VariantResult analyzeVariant(
            Map<String, List<Double>> testMetrics,
            Map<String, List<Double>> controlMetrics) {
        
        ExperimentResult.VariantResult result = new ExperimentResult.VariantResult();
        
        for (Map.Entry<String, List<Double>> entry : testMetrics.entrySet()) {
            String metric = entry.getKey();
            List<Double> testValues = entry.getValue();
            List<Double> controlValues = controlMetrics.get(metric);
            
            // 计算改进幅度
            double testMean = calculateMean(testValues);
            double controlMean = calculateMean(controlValues);
            double improvement = (testMean - controlMean) / controlMean;
            
            // 计算统计显著性
            double pValue = calculatePValue(testValues, controlValues);
            
            result.getMetrics().put(metric, testMean);
            result.getImprovements().put(metric, improvement);
            result.getPValues().put(metric, pValue);
        }
        
        return result;
    }
    
    private double calculateMean(List<Double> values) {
        return values.stream()
            .mapToDouble(Double::doubleValue)
            .average()
            .orElse(0.0);
    }
    
    private double calculatePValue(List<Double> test, List<Double> control) {
        double[] testArray = test.stream().mapToDouble(Double::doubleValue).toArray();
        double[] controlArray = control.stream().mapToDouble(Double::doubleValue).toArray();
        
        try {
            return tTest.tTest(testArray, controlArray);
        } catch (Exception e) {
            return 1.0; // 如果无法计算,返回1表示不显著
        }
    }
    
    private void determineWinner(ExperimentResult result) {
        String winner = null;
        double bestImprovement = 0;
        
        for (Map.Entry<String, ExperimentResult.VariantResult> entry : 
             result.getVariantResults().entrySet()) {
            
            String variant = entry.getKey();
            ExperimentResult.VariantResult variantResult = entry.getValue();
            
            // 检查是否有显著的改进
            boolean significant = variantResult.getPValues().values().stream()
                .anyMatch(p -> p < SIGNIFICANCE_LEVEL);
                
            if (significant) {
                double avgImprovement = variantResult.getImprovements().values().stream()
                    .mapToDouble(Double::doubleValue)
                    .average()
                    .orElse(0.0);
                    
                if (avgImprovement > bestImprovement) {
                    bestImprovement = avgImprovement;
                    winner = variant;
                }
            }
        }
        
        result.setWinningVariant(winner);
        result.setSignificant(winner != null);
    }
} 