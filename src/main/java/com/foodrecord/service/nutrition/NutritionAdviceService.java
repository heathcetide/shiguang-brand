//package com.foodrecord.service.nutrition;
//
//import com.foodrecord.model.entity.NutritionAdvice;
//import com.foodrecord.model.entity.NutritionAnalysis;
//import com.foodrecord.model.entity.UserDietStats;
//import com.foodrecord.service.NutritionAnalysisService;
//import com.foodrecord.service.impl.UserDietStatsServiceImpl;
//import lombok.RequiredArgsConstructor;
//import org.springframework.stereotype.Service;
//
///**
// * 营养建议生成服务
// */
//@Service
//@RequiredArgsConstructor
//public class NutritionAdviceService {
//    private final UserDietStatsServiceImpl dietStatsService;
//    private final NutritionAnalysisService nutritionAnalysisService;
//
//    /**
//     * 生成营养建议
//     */
//    public NutritionAdvice generateAdvice(Long userId) {
//        // 1. 获取用户近期饮食统计
//        UserDietStats recentStats = dietStatsService.getRecentStats(userId);
//
//        // 2. 分析营养状况
//        NutritionAnalysis analysis = nutritionAnalysisService.analyze(userId);
//
//        // 3. 生成建议
//        NutritionAdvice advice = new NutritionAdvice();
//
//        // 3.1 营养素建议
//        generateNutrientAdvice(advice, analysis);
//
//        // 3.2 食物选择建议
//        generateFoodChoiceAdvice(advice, analysis);
//
//        // 3.3 饮食习惯建议
//        generateDietaryHabitAdvice(advice, recentStats);
//
//        // 3.4 健康警告
//        generateHealthWarnings(advice, analysis);
//
//        return advice;
//    }
//
//}