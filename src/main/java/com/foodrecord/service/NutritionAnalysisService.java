package com.foodrecord.service;

import com.foodrecord.model.entity.NutritionAnalysis;

public interface NutritionAnalysisService {

    /**
     * 根据用户ID分析营养摄入
     *
     * @param userId 用户ID
     * @return 营养分析结果
     */
    NutritionAnalysis analyze(Long userId);
}
