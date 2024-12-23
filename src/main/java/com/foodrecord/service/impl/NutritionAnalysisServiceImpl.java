package com.foodrecord.service.impl;

import com.foodrecord.model.entity.NutritionAnalysis;
import com.foodrecord.service.NutritionAnalysisService;
import org.springframework.stereotype.Service;

@Service
public class NutritionAnalysisServiceImpl implements NutritionAnalysisService {

    private final UserDietRecordServiceImpl dietRecordService;

    public NutritionAnalysisServiceImpl(UserDietRecordServiceImpl dietRecordService) {
        this.dietRecordService = dietRecordService;
    }

    @Override
    public NutritionAnalysis analyze(Long userId) {
//        // 获取用户最近的饮食记录
//        List<UserDietRecord> dietRecords = dietRecordService.findRecentRecords(userId, 7);
//
//        // 初始化分析结果
//        NutritionAnalysis analysis = new NutritionAnalysis();
//        double totalProtein = 0;
//        double totalFat = 0;
//        double totalCarb = 0;
//        double totalCalory = 0;
//
//        for (UserDietRecord record : dietRecords) {
//            double portionRatio = record.getPortionSize() / 100.0;
//
//            totalProtein += record.getFood().getNutrition().getProtein() * portionRatio;
//            totalFat += record.getFood().getNutrition().getFat() * portionRatio;
//            totalCarb += record.getFood().getNutrition().getCarbohydrate() * portionRatio;
//            totalCalory += record.getFood().getNutrition().getCalory() * portionRatio;
//        }
//
//        // 设置营养平衡分析结果
//        analysis.setProteinBalance(analyzeProteinBalance(totalProtein));
//        analysis.setFatBalance(analyzeFatBalance(totalFat));
//        analysis.setCarbBalance(analyzeCarbBalance(totalCarb));
//
//        // 设置改进建议
//        analysis.setImprovementSuggestions(generateImprovementSuggestions(totalProtein, totalFat, totalCarb, totalCalory));

//        return analysis;
        return null;
    }

    private String analyzeProteinBalance(double totalProtein) {
        if (totalProtein < 50) {
            return "不足";
        } else if (totalProtein > 150) {
            return "过量";
        }
        return "适中";
    }

    private String analyzeFatBalance(double totalFat) {
        if (totalFat < 30) {
            return "不足";
        } else if (totalFat > 70) {
            return "过量";
        }
        return "适中";
    }

    private String analyzeCarbBalance(double totalCarb) {
        if (totalCarb < 200) {
            return "不足";
        } else if (totalCarb > 300) {
            return "过量";
        }
        return "适中";
    }

    private String generateImprovementSuggestions(double protein, double fat, double carb, double calory) {
        StringBuilder suggestions = new StringBuilder();

        if (protein < 50) {
            suggestions.append("增加蛋白质摄入，如鸡胸肉、鱼类等。\n");
        }
        if (protein > 150) {
            suggestions.append("减少高蛋白食物摄入，避免肾脏负担。\n");
        }

        if (fat < 30) {
            suggestions.append("适量增加健康脂肪摄入，如橄榄油、坚果等。\n");
        }
        if (fat > 70) {
            suggestions.append("减少高脂肪食物摄入，如油炸食品。\n");
        }

        if (carb < 200) {
            suggestions.append("增加碳水化合物摄入，如全麦面包、糙米等。\n");
        }
        if (carb > 300) {
            suggestions.append("减少精制碳水化合物摄入，如含糖饮料。\n");
        }

        if (calory > 2000) {
            suggestions.append("注意总能量摄入，避免过量饮食。\n");
        }

        return suggestions.toString();
    }
}
