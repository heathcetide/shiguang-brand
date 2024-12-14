//package com.foodrecord.service.recommendation;
//
//import com.foodrecord.model.entity.*;
//import com.foodrecord.service.*;
//import lombok.RequiredArgsConstructor;
//import org.springframework.cache.annotation.CacheConfig;
//import org.springframework.cache.annotation.CacheEvict;
//import org.springframework.cache.annotation.Cacheable;
//import org.springframework.stereotype.Service;
//
//import java.time.LocalTime;
//import java.util.*;
//import java.util.stream.Collectors;
//
///**
// * 食物推荐服务
// * 基于用户画像、营养需求和历史行为的智能推荐
// */
//@Service
//@RequiredArgsConstructor
//@CacheConfig(cacheNames = "recommendation")
//public class FoodRecommendationService {
//    private final UserDietaryGoalsService dietaryGoalsService;
//    private final UserHealthDataService healthDataService;
//    private final UserDietRecordService dietRecordService;
//    private final FoodService foodService;
//    private final NutritionService nutritionService;
//
//    /**
//     * 获取个性化食物推荐
//     */
//    @Cacheable(key = "'user:' + #userId + ':recommendations'",
//               condition = "#refresh == false",
//               unless = "#result.isEmpty()")
//    public List<FoodRecommendation> getRecommendations(Long userId, boolean refresh) {
//        return generateRecommendations(userId);
//    }
//
//    @CacheEvict(key = "'user:' + #userId + ':recommendations'")
//    public void refreshRecommendations(Long userId) {
//        // 强制刷新推荐
//    }
//
//    /**
//     * 构建用户画像
//     */
//    private UserProfile buildUserProfile(Long userId) {
//        UserProfile profile = new UserProfile();
//
//        // 获取用户基本信息
//        UserHealthData healthData = healthDataService.getByUserId(userId);
//        profile.setHealthData(healthData);
//
//        // 获取营养目标
//        UserDietaryGoals goals = dietaryGoalsService.getByUserId(userId);
//        profile.setDietaryGoals(goals);
//
//        // 分析历史饮食记录
//        List<UserDietRecord> recentRecords = dietRecordService
//            .getRecentRecords(userId, 30); // 最近30天
//        profile.setDietaryPreferences(analyzeDietaryPreferences(recentRecords));
//
//        return profile;
//    }
//
//    /**
//     * 分析饮食偏好
//     */
//    private DietaryPreferences analyzeDietaryPreferences(List<UserDietRecord> records) {
//        DietaryPreferences preferences = new DietaryPreferences();
//
//        // 分析常吃食物
//        Map<Long, Integer> foodFrequency = new HashMap<>();
//        records.forEach(record ->
//            foodFrequency.merge(record.getFoodId(), 1, Integer::sum));
//        preferences.setFavoriteFoods(foodFrequency);
//
//        // 分析营养摄入趋势
//        Map<String, Double> nutritionTrends = analyzeNutritionTrends(records);
//        preferences.setNutritionTrends(nutritionTrends);
//
//        // 分析用餐时间规律
//        Map<Integer, List<LocalTime>> mealTimes = analyzeMealTimes(records);
//        preferences.setMealTimePatterns(mealTimes);
//
//        return preferences;
//    }
//
//    /**
//     * 获取候选食物
//     */
//    private List<Food> getCandidateFoods(UserProfile userProfile) {
//        // 基于用户健康目标筛选
//        String healthGoal = userProfile.getHealthData().getHealthGoal();
//        List<Food> candidates = foodService.findByHealthGoal(healthGoal);
//
//        // 考虑季节性和时令
//        candidates = filterBySeasonality(candidates);
//
//        // 排除近期经常食用的
//        Set<Long> recentFoods = userProfile.getDietaryPreferences()
//            .getFavoriteFood().keySet();
//        candidates.removeIf(food -> recentFoods.contains(food.getId()));
//
//        return candidates;
//    }
//
//    /**
//     * 计算推荐分数
//     */
//    private List<FoodRecommendation> calculateRecommendationScores(
//            Long userId, List<Food> foods, UserProfile profile) {
//        List<FoodRecommendation> recommendations = new ArrayList<>();
//
//        for (Food food : foods) {
//            double score = 0.0;
//            String reason = String.valueOf(new StringBuilder());
//
//            // 1. 营养匹配度评分 (40%)
//            double nutritionScore = calculateNutritionScore(food, profile);
//            score += nutritionScore * 0.4;
//
//            // 2. 健康目标匹配度评分 (30%)
//            double healthScore = calculateHealthScore(food, profile);
//            score += healthScore * 0.3;
//
//            // 3. 用户偏好匹配度评分 (20%)
//            double preferenceScore = calculatePreferenceScore(food, profile);
//            score += preferenceScore * 0.2;
//
//            // 4. 多样性评分 (10%)
//            double diversityScore = calculateDiversityScore(food, profile);
//            score += diversityScore * 0.1;
//
//            // 创建推荐记录
//            FoodRecommendation recommendation = new FoodRecommendation();
//            recommendation.setUserId(userId);
//            recommendation.setFoodId(food.getId());
//            recommendation.setRecommendationScore(score);
//            recommendation.setReason(buildRecommendationReason(
//                nutritionScore, healthScore, preferenceScore, diversityScore));
//
//            recommendations.add(recommendation);
//        }
//
//        return recommendations;
//    }
//
//    /**
//     * 计算营养匹配度分数
//     */
//    private double calculateNutritionScore(Food food, UserProfile profile) {
//        Nutrition nutrition = nutritionService.getByFoodId(food.getId());
//        UserDietaryGoals goals = profile.getDietaryGoals();
//
//        // 计算各营养素的匹配度
//        double proteinMatch = calculateMatch(
//            nutrition.getProtein(), goals.getProteinTarget());
//        double fatMatch = calculateMatch(
//            nutrition.getFat(), goals.getFatTarget());
//        double carbMatch = calculateMatch(
//            nutrition.getCarbohydrate(), goals.getCarbTarget());
//
//        // 加权平均
//        return (proteinMatch * 0.4 + fatMatch * 0.3 + carbMatch * 0.3);
//    }
//
//    // ... 其他评分方法实现
//}