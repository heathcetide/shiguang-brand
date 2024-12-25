package com.foodrecord.ml.feature;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Component
public class FeatureEngineering {

    public double[] createUserContextFeatures(Long userId, String timeOfDay, String dayOfWeek) {
        List<Double> features = new ArrayList<>();

        // 时间特征
        features.addAll(encodeTimeOfDay(timeOfDay));
        features.addAll(encodeDayOfWeek(dayOfWeek));

        // 用户历史行为特征
        features.addAll(getUserHistoryFeatures(userId));

        // 用户健康目标特征
        features.addAll(getUserHealthGoalFeatures(userId));

        return features.stream().mapToDouble(Double::doubleValue).toArray();
    }

    public double[] createFoodContextFeatures(Long foodId) {
        List<Double> features = new ArrayList<>();

        // 食物基本特征
        features.addAll(getFoodBasicFeatures(foodId));

        // 食物流行度特征
        features.addAll(getFoodPopularityFeatures(foodId));

        // 食物营养特征
        features.addAll(getFoodNutritionFeatures(foodId));

        return features.stream().mapToDouble(Double::doubleValue).toArray();
    }

    private List<Double> getUserHistoryFeatures(Long userId) {
        // 实现用户历史行为特征提取
        return new ArrayList<>();
    }

    private List<Double> getUserHealthGoalFeatures(Long userId) {
        // 实现用户健康目标特征提取
        return new ArrayList<>();
    }

    private List<Double> getFoodBasicFeatures(Long foodId) {
        // 实现食物基本特征提取
        return new ArrayList<>();
    }

    private List<Double> getFoodPopularityFeatures(Long foodId) {
        // 实现食物流行度特征提取
        return new ArrayList<>();
    }

    private List<Double> getFoodNutritionFeatures(Long foodId) {
        // 实现食物营养特征提取
        return new ArrayList<>();
    }

    private List<Double> encodeTimeOfDay(String timeOfDay) {
        List<Double> features = new ArrayList<>();

        // 使用 One-Hot 编码表示时间段
        switch (timeOfDay.toUpperCase()) {
            case "MORNING": // 早晨
                features.add(1.0); // MORNING
                features.add(0.0); // AFTERNOON
                features.add(0.0); // EVENING
                features.add(0.0); // NIGHT
                break;
            case "AFTERNOON": // 下午
                features.add(0.0);
                features.add(1.0);
                features.add(0.0);
                features.add(0.0);
                break;
            case "EVENING": // 晚上
                features.add(0.0);
                features.add(0.0);
                features.add(1.0);
                features.add(0.0);
                break;
            case "NIGHT": // 夜晚
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(1.0);
                break;
            default:
                // 默认值（例如未知时间段）
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                break;
        }

        return features;
    }

    private List<Double> encodeDayOfWeek(String dayOfWeek) {
        List<Double> features = new ArrayList<>();

        // 使用 One-Hot 编码表示星期几
        switch (dayOfWeek.toUpperCase()) {
            case "MONDAY":
                features.add(1.0); // MONDAY
                features.add(0.0); // TUESDAY
                features.add(0.0); // WEDNESDAY
                features.add(0.0); // THURSDAY
                features.add(0.0); // FRIDAY
                features.add(0.0); // SATURDAY
                features.add(0.0); // SUNDAY
                break;
            case "TUESDAY":
                features.add(0.0);
                features.add(1.0);
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                break;
            case "WEDNESDAY":
                features.add(0.0);
                features.add(0.0);
                features.add(1.0);
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                break;
            case "THURSDAY":
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(1.0);
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                break;
            case "FRIDAY":
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(1.0);
                features.add(0.0);
                features.add(0.0);
                break;
            case "SATURDAY":
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(1.0);
                features.add(0.0);
                break;
            case "SUNDAY":
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(1.0);
                break;
            default:
                // 默认值（例如未知日期）
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                features.add(0.0);
                break;
        }

        return features;
    }

    public double[] combineFeatures(UserFeature userFeature, FoodFeature foodFeature) {
        // 假设模型需要的特征维度为 15
        List<Double> combinedFeatures = new ArrayList<>();

        // 添加用户特征（10 个）
        combinedFeatures.add(userFeature.getAge() != null ? (double) userFeature.getAge() : 18.0); // 默认 18 岁
        combinedFeatures.add(userFeature.getGender() != null && userFeature.getGender().equals("M") ? 1.0 : 0.0); // 男性 1.0，女性 0.0
        combinedFeatures.add(userFeature.getBmi() != null ? (double) userFeature.getBmi() : 22.0); // 默认 BMI 为 22
        combinedFeatures.add(userFeature.getBloodPressure() != null ? (double) userFeature.getBloodPressure() : 120.0); // 默认血压 120
        combinedFeatures.add(userFeature.getBloodSugar() != null ? (double) userFeature.getBloodSugar() : 5.0); // 默认血糖 5.0
        combinedFeatures.add(userFeature.getActivityLevel() != null ? (double) userFeature.getActivityLevel() : 1.0); // 默认活动等级为 1
        combinedFeatures.add(userFeature.getAvgCaloryIntake() != null ? (double) userFeature.getAvgCaloryIntake() : 2000.0); // 默认摄入 2000 卡路里
        combinedFeatures.add(0.0); // 预留或未使用的特征
        combinedFeatures.add(0.0); // 预留或未使用的特征
        combinedFeatures.add(0.0); // 预留或未使用的特征

        // 添加食物特征（5 个）
        combinedFeatures.add(foodFeature.getCalory() != null ? (double) foodFeature.getCalory() : 0.0); // 食物卡路里
        combinedFeatures.add(foodFeature.getProtein() != null ? (double) foodFeature.getProtein() : 0.0); // 蛋白质
        combinedFeatures.add(foodFeature.getFat() != null ? (double) foodFeature.getFat() : 0.0); // 脂肪
        combinedFeatures.add(foodFeature.getCarbohydrate() != null ? (double) foodFeature.getCarbohydrate() : 0.0); // 碳水化合物
        combinedFeatures.add(foodFeature.getAverageRating() != null ? (double) foodFeature.getAverageRating() : 0.0); // 平均评分

        // 验证特征维度是否为 15
        if (combinedFeatures.size() != 15) {
            throw new IllegalStateException("Feature vector size is incorrect. Expected 15, but got " + combinedFeatures.size());
        }

        // 转换为数组
        return combinedFeatures.stream().mapToDouble(Double::doubleValue).toArray();
    }


//    public double[] combineFeatures(UserFeature userFeature, FoodFeature foodFeature) {
//        // 假设 userFeature 和 foodFeature 都有一个方法 getFeatureArray() 返回 double[]
//        double[] userArray = userFeature.getFeatureArray();
//        double[] foodArray = foodFeature.getFeatureArray();
//
//        double[] combined = new double[userArray.length + foodArray.length];
//        System.arraycopy(userArray, 0, combined, 0, userArray.length);
//        System.arraycopy(foodArray, 0, combined, userArray.length, foodArray.length);
//
//        return combined;
//    }

}