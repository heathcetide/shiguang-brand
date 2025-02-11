//package com.foodrecord.ml.feature;
////TODO ml
//import com.foodrecord.core.logging.ml.FeatureVector;
//import com.foodrecord.core.logging.ml.LogEntry;
//import com.foodrecord.mapper.NutritionMapper;
//import com.foodrecord.mapper.UserDietRecordMapper;
//import com.foodrecord.mapper.UserFeedbackMapper;
//import com.foodrecord.mapper.UserHealthDataMapper;
//import com.foodrecord.model.entity.Nutrition;
//import com.foodrecord.model.entity.User;
//import com.foodrecord.model.entity.UserDietRecord;
//import com.foodrecord.model.entity.UserFeedback;
//import com.foodrecord.model.entity.UserHealthData;
//import org.springframework.stereotype.Component;
//import com.foodrecord.model.entity.Food;
//
//import javax.annotation.Resource;
//import java.util.ArrayList;
//import java.util.List;
//import java.util.Map;
//import java.util.function.Function;
//import java.util.stream.Collectors;
//
//@Component("mlFeatureExtractor")
//public class FeatureExtractor {
//
//    @Resource
//    private UserDietRecordMapper userDietRecordMapper;
//
//    @Resource
//    private UserHealthDataMapper userHealthDataMapper;
//
//    @Resource
//    private NutritionMapper nutritionMapper;
//
//    @Resource
//    private UserFeedbackMapper userFeedbackMapper;
//
//    public UserFeature extractUserFeature(User user) {
//        UserFeature feature = new UserFeature();
//        feature.setUserId(user.getId());
//
//        // 从user_health_data表中提取健康数据
//        UserHealthData healthData = userHealthDataMapper.selectByUserId(user.getId());
//
//        if (healthData != null) {
//            feature.setAge(healthData.getAge() == null ? 18 : healthData.getAge()); // 默认年龄为 18
//            feature.setGender(healthData.getGender() == 0 ? "女" : "男");
//            feature.setBmi(healthData.getBmi());
//            feature.setBloodPressure((healthData.getBloodPressureHigh() + healthData.getBloodPressureLow()) / 2.0f);
//            feature.setBloodSugar(healthData.getBloodSugar());
//            feature.setActivityLevel(healthData.getActivityLevel());
//        } else {
//            // 当用户健康数据为空时，设置默认值
//            feature.setAge(18);
//            feature.setGender("未知");
//            feature.setBmi(22.0f); // 平均 BMI
//            feature.setBloodPressure(120.0f); // 正常血压
//            feature.setBloodSugar(5.0f); // 正常血糖
//            feature.setActivityLevel(1); // 默认活动等级
//        }
//
//        // 提取用户饮食习惯特征
//        List<UserDietRecord> dietRecords = userDietRecordMapper.selectRecentByUserId(user.getId(), 30); // 最近30天
//        if (dietRecords == null || dietRecords.isEmpty()) {
//            System.out.println("No diet records found for user ID: " + user.getId());
//            return feature; // 返回空特征
//        }
//        feature.setAvgCaloryIntake(calculateAvgCalory(dietRecords));
//        feature.setPreferredMealTime(extractPreferredMealTime(dietRecords));
//        feature.setFavoriteCategories(extractFavoriteCategories(dietRecords));
//
//
//        return feature;
//    }
//
//    public FoodFeature extractFoodFeature(Food food) {
//        FoodFeature feature = new FoodFeature();
//        feature.setFoodId(food.getId());
//
//        // 从nutrition表提取营养信息
//        Nutrition nutrition = nutritionMapper.selectByFoodId(food.getId());
//        if (nutrition != null) {
//            feature.setCalory(nutrition.getCalory() != null ? nutrition.getCalory() : 0.0f); // 默认值为0
//            feature.setProtein(nutrition.getProtein() != null ? nutrition.getProtein() : 0.0f);
//            feature.setFat(nutrition.getFat() != null ? nutrition.getFat() : 0.0f);
//            feature.setCarbohydrate(nutrition.getCarbohydrate() != null ? nutrition.getCarbohydrate() : 0.0f);
//        } else {
//            System.out.println("No nutrition data found for food ID: " + food.getId());
//            // 设置默认营养数据
//            feature.setCalory(0.0f);
//            feature.setProtein(0.0f);
//            feature.setFat(0.0f);
//            feature.setCarbohydrate(0.0f);
//        }
//
//        // 从food_basic表提取基本信息
//        feature.setHealthLight(food.getHealthLight());
//        feature.setHealthLabel(food.getHealthLabel());
//
//        // 提取食物受欢迎程度特征
//        List<UserFeedback> feedbacks = userFeedbackMapper.selectByFoodId(food.getId());
//        if (!feedbacks.isEmpty()) {
//            feature.setAverageRating(calculateAverageRating(feedbacks));
//            feature.setPopularityScore(calculatePopularityScore(feedbacks));
//        }
//
//        return feature;
//    }
//
//    private Float calculateAvgCalory(List<UserDietRecord> records) {
//        // 计算平均卡路里摄入
//        return (float) records.stream()
//                .mapToDouble(r -> r.getCalory())
//                .average()
//                .orElse(0.0);
//    }
//
//    private String extractPreferredMealTime(List<UserDietRecord> records) {
//        // 分析用户首选用餐时间
//        Map<String, Long> mealTimeCounts = records.stream()
//                .collect(Collectors.groupingBy(
//                        UserDietRecord::getMealType,
//                        Collectors.counting()
//                ));
//        return mealTimeCounts.entrySet().stream()
//                .max(Map.Entry.comparingByValue())
//                .map(Map.Entry::getKey)
//                .orElse("LUNCH");
//    }
//
//    private List<String> extractFavoriteCategories(List<UserDietRecord> records) {
//        // 提取用户最喜欢的食物类别
//        return records.stream()
//                .map(r -> r.getFoodCategory())
//                .collect(Collectors.groupingBy(
//                        Function.identity(),
//                        Collectors.counting()
//                ))
//                .entrySet().stream()
//                .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
//                .limit(3)
//                .map(Map.Entry::getKey)
//                .collect(Collectors.toList());
//    }
//
//    private Float calculateAverageRating(List<UserFeedback> feedbacks) {
//        // 计算用户对食物的平均评分
//        return (float) feedbacks.stream()
//                .mapToDouble(UserFeedback::getRating)
//                .average()
//                .orElse(0.0);
//    }
//
//    private Float calculatePopularityScore(List<UserFeedback> feedbacks) {
//        // 计算食物的流行度评分（例如基于评分数量）
//        return (float) feedbacks.size();
//    }
//
//    public List<FeatureVector> extractFeatures(List<LogEntry> logs) {
//        List<FeatureVector> features = new ArrayList<>();
//        for (LogEntry log : logs) {
//            // 根据日志记录提取特征
////            FeatureVector feature = new FeatureVector();
////            feature.addFeature("timestamp", log.getTimestamp());
////            feature.addFeature("logLevel", log.getLevel().ordinal());
////            feature.addFeature("messageLength", log.getMessage().length());
////            feature.addFeature("source", log.getSource().hashCode());
////            features.add(feature);
//        }
//        return features;
//    }
//
//}