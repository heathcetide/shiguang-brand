
package com.foodrecord.ml.feature;

import com.foodrecord.ml.entity.UserFoodInteraction;
import com.foodrecord.ml.model.FoodNutrition;
import com.foodrecord.ml.model.UserHealthProfile;
import org.springframework.stereotype.Component;
import java.time.LocalDateTime;
import java.util.*;

@Component
public class AdvancedFeatureEngineering {



    public double[] createTemporalFeatures(LocalDateTime timestamp) {
        List<Double> features = new ArrayList<>();

        // 时间周期性特征
        features.add(Math.sin(2 * Math.PI * timestamp.getHour() / 24.0));
        features.add(Math.cos(2 * Math.PI * timestamp.getHour() / 24.0));
        features.add(Math.sin(2 * Math.PI * timestamp.getDayOfWeek().getValue() / 7.0));
        features.add(Math.cos(2 * Math.PI * timestamp.getDayOfWeek().getValue() / 7.0));

        // 用餐时间特征
        features.add(isBreakfastTime(timestamp) ? 1.0 : 0.0);
        features.add(isLunchTime(timestamp) ? 1.0 : 0.0);
        features.add(isDinnerTime(timestamp) ? 1.0 : 0.0);

        return features.stream().mapToDouble(Double::doubleValue).toArray();
    }

    public double[] createUserSequenceFeatures(List<UserFoodInteraction> history) {
        List<Double> features = new ArrayList<>();

        // 最近N次交互的统计特征
        features.addAll(extractRecentInteractionFeatures(history, 5));

        // 用户行为序列模式
        features.addAll(extractSequencePatterns(history));

        // 时间间隔特征
        features.addAll(extractTimeIntervalFeatures(history));

        return features.stream().mapToDouble(Double::doubleValue).toArray();
    }

    public double[] createHealthFeatures(UserHealthProfile profile, FoodNutrition nutrition) {
        List<Double> features = new ArrayList<>();

        // 营养匹配度
        features.add(calculateNutritionMatch(profile, nutrition));

        // 健康目标相关性
        features.add(calculateHealthGoalRelevance(profile, nutrition));

        // 过敏风险
        features.add(calculateAllergyRisk(profile, nutrition));

        return features.stream().mapToDouble(Double::doubleValue).toArray();
    }

    private double calculateNutritionMatch(UserHealthProfile profile, FoodNutrition nutrition) {
        double proteinMatch = Math.abs(profile.getProteinGoal() - nutrition.getProtein());
        double fatMatch = Math.abs(profile.getFatGoal() - nutrition.getFat());
        double carbMatch = Math.abs(profile.getCarbGoal() - nutrition.getCarbohydrate());
        return 1 / (1 + proteinMatch + fatMatch + carbMatch); // 假设匹配越接近值越高
    }


    private double calculateHealthGoalRelevance(UserHealthProfile profile, FoodNutrition nutrition) {
        double relevance = 0.0;
        // 根据用户的健康���标计算食物的相关性
        // 例如减重、增肌等目标
        return relevance;
    }

    private List<Double> extractSequencePatterns(List<UserFoodInteraction> history) {
        List<Double> patterns = new ArrayList<>();
        // 提取用户行为序列中的模式
        // 使用序列模式挖掘算法
        return patterns;
    }

    private boolean isBreakfastTime(LocalDateTime timestamp) {
        int hour = timestamp.getHour();
        return hour >= 6 && hour < 10; // 6:00-10:00 作为早餐时间
    }

    private boolean isLunchTime(LocalDateTime timestamp) {
        int hour = timestamp.getHour();
        return hour >= 11 && hour < 14; // 11:00-14:00 作为午餐时间
    }

    private boolean isDinnerTime(LocalDateTime timestamp) {
        int hour = timestamp.getHour();
        return hour >= 18 && hour < 21; // 18:00-21:00 作为晚餐时间
    }

    private List<Double> extractRecentInteractionFeatures(List<UserFoodInteraction> history, int n) {
        List<Double> features = new ArrayList<>();
        int size = history.size();

        // 获取最近N次交互记录
        List<UserFoodInteraction> recentInteractions = history.subList(Math.max(0, size - n), size);

        // 统计最近N次交互的平均评分
        double averageRating = recentInteractions.stream()
                .mapToDouble(UserFoodInteraction::getRating)
                .average()
                .orElse(0.0);

        // 添加平均评分作为特征
        features.add(averageRating);

        // 添加最近一次的评分
        if (!recentInteractions.isEmpty()) {
            features.add(recentInteractions.get(recentInteractions.size() - 1).getRating());
        }

        return features;
    }

    private List<Double> extractTimeIntervalFeatures(List<UserFoodInteraction> history) {
        List<Double> features = new ArrayList<>();

        for (int i = 1; i < history.size(); i++) {
            // 计算相邻两次交互之间的时间间隔（以秒为单位）
            long interval = (history.get(i).getInteractionTime().getTime()
                    - history.get(i - 1).getInteractionTime().getTime()) / 1000;

            features.add((double) interval);
        }

        // 统计特征，例如平均时间间隔
        double averageInterval = features.stream()
                .mapToDouble(Double::doubleValue)
                .average()
                .orElse(0.0);
        features.add(averageInterval);

        return features;
    }

    private double calculateAllergyRisk(UserHealthProfile profile, FoodNutrition nutrition) {
        // 示例逻辑：假设用户对某些成分（例如乳糖）过敏
        boolean isAllergic = profile.isLactoseIntolerant() && nutrition.containsLactose();

        // 如果过敏，返回高风险分值，否则返回低风险
        return isAllergic ? 1.0 : 0.0;
    }

}