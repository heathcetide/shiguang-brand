//package com.foodrecord.service.recommendation;
//
//import com.foodrecord.model.entity.*;
//import com.foodrecord.repository.FoodRecommendationRepository;
//import com.foodrecord.service.*;
//import lombok.RequiredArgsConstructor;
//import org.springframework.stereotype.Service;
//import org.springframework.transaction.annotation.Transactional;
//
//import java.util.List;
//import java.util.Map;
//import java.util.stream.Collectors;
//
///**
// * 食物推荐服务实现类
// */
//@Service
//@RequiredArgsConstructor
//public class FoodRecommendationServiceImpl implements FoodRecommendationService {
//    private final FoodRecommendationRepository recommendationRepository;
//    private final UserDietaryGoalsService dietaryGoalsService;
//    private final UserHealthDataService healthDataService;
//    private final UserDietRecordService dietRecordService;
//    private final FoodService foodService;
//    private final NutritionService nutritionService;
//
//    @Override
//    @Transactional(readOnly = true)
//    public List<FoodRecommendation> getPersonalizedRecommendations(Long userId) {
//        // 1. 获取用户画像
//        UserProfile userProfile = buildUserProfile(userId);
//
//        // 2. 获���候选食物列表
//        List<Food> candidateFoods = getCandidateFoods(userProfile);
//
//        // 3. 计算推荐分数
//        List<FoodRecommendation> recommendations = calculateRecommendationScores(
//            userId, candidateFoods, userProfile);
//
//        // 4. 排序和过滤
//        return filterAndSortRecommendations(recommendations);
//    }
//
//    @Override
//    @Transactional(readOnly = true)
//    public List<FoodRecommendation> getRecommendationsByType(Long userId, String type) {
//        return recommendationRepository.findByUserIdAndType(userId, type);
//    }
//
//    @Override
//    @Transactional(readOnly = true)
//    public List<FoodRecommendation> getTopRecommendations(Long userId, int limit) {
//        return recommendationRepository.findTopRecommendations(userId, limit);
//    }
//
//    // ... 其他私有方法实现
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
//        List<UserDietRecord> recentRecords = dietRecordService.getRecentRecords(userId, 30); // 最近30天
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
//        // 分析常吃食物频率
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
//     * 分析营养摄入趋势
//     */
//    private Map<String, Double> analyzeNutritionTrends(List<UserDietRecord> records) {
//        Map<String, Double> trends = new HashMap<>();
//
//        // 按日期分组计算每日营养摄入
//        Map<LocalDate, List<UserDietRecord>> dailyRecords = records.stream()
//            .collect(Collectors.groupingBy(r -> r.getMealTime().toLocalDate()));
//
//        // 计算各营养素的平均摄入量
//        dailyRecords.values().forEach(dayRecords -> {
//            double totalCalories = 0;
//            double totalProtein = 0;
//            double totalFat = 0;
//            double totalCarbs = 0;
//
//            for (UserDietRecord record : dayRecords) {
//                Nutrition nutrition = nutritionService.getByFoodId(record.getFoodId());
//                double portionRatio = record.getPortionSize() / 100.0; // 假设营养值基于100g
//
//                totalCalories += nutrition.getCalory() * portionRatio;
//                totalProtein += nutrition.getProtein() * portionRatio;
//                totalFat += nutrition.getFat() * portionRatio;
//                totalCarbs += nutrition.getCarbohydrate() * portionRatio;
//            }
//
//            // 累加到趋势中
//            trends.merge("calories", totalCalories, Double::sum);
//            trends.merge("protein", totalProtein, Double::sum);
//            trends.merge("fat", totalFat, Double::sum);
//            trends.merge("carbs", totalCarbs, Double::sum);
//        });
//
//        // 计���平均值
//        int days = dailyRecords.size();
//        trends.replaceAll((k, v) -> v / days);
//
//        return trends;
//    }
//
//    /**
//     * 分析用餐时间规律
//     */
//    private Map<Integer, List<LocalTime>> analyzeMealTimes(List<UserDietRecord> records) {
//        return records.stream()
//            .collect(Collectors.groupingBy(
//                r -> r.getMealTime().getHour(),
//                Collectors.mapping(r -> r.getMealTime().toLocalTime(), Collectors.toList())
//            ));
//    }
//
//    /**
//     * 获取候选食物列表
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
//            .getFavoriteFoods().keySet();
//        candidates.removeIf(food -> recentFoods.contains(food.getId()));
//
//        return candidates;
//    }
//
//    /**
//     * 根据季节性过滤食物
//     */
//    private List<Food> filterBySeasonality(List<Food> foods) {
//        Month currentMonth = LocalDate.now().getMonth();
//        Season currentSeason = Season.fromMonth(currentMonth);
//
//        return foods.stream()
//            .filter(food -> {
//                // 获取食物的季节性标签
//                List<String> tags = food.getTags();
//                if (tags == null || tags.isEmpty()) {
//                    return true; // 没有季节标签的食物默认保留
//                }
//
//                // 检查是否包含当前季节的标签
//                return tags.contains(currentSeason.name().toLowerCase()) ||
//                       tags.contains("all_season");
//            })
//            .collect(Collectors.toList());
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
//            StringBuilder reason = new StringBuilder();
//
//            // 1. 营养匹配度评分 (40%)
//            double nutritionScore = calculateNutritionScore(food, profile);
//            score += nutritionScore * 0.4;
//            reason.append(String.format("营养匹配度: %.1f%%; ", nutritionScore));
//
//            // 2. 健康目标匹配度评分 (30%)
//            double healthScore = calculateHealthScore(food, profile);
//            score += healthScore * 0.3;
//            reason.append(String.format("健康目标匹配度: %.1f%%; ", healthScore));
//
//            // 3. 用户偏好匹配度评分 (20%)
//            double preferenceScore = calculatePreferenceScore(food, profile);
//            score += preferenceScore * 0.2;
//            reason.append(String.format("偏好匹配度: %.1f%%; ", preferenceScore));
//
//            // 4. 多样性评分 (10%)
//            double diversityScore = calculateDiversityScore(food, profile);
//            score += diversityScore * 0.1;
//            reason.append(String.format("多样性: %.1f%%", diversityScore));
//
//            // 创建推荐记录
//            FoodRecommendation recommendation = new FoodRecommendation();
//            recommendation.setUserId(userId);
//            recommendation.setFoodId(food.getId());
//            recommendation.setRecommendationScore(score);
//            recommendation.setReason(reason.toString());
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
//        double proteinMatch = calculateNutrientMatch(
//            nutrition.getProtein(), goals.getProteinTarget());
//        double fatMatch = calculateNutrientMatch(
//            nutrition.getFat(), goals.getFatTarget());
//        double carbMatch = calculateNutrientMatch(
//            nutrition.getCarbohydrate(), goals.getCarbTarget());
//        double fiberMatch = calculateNutrientMatch(
//            nutrition.getFiberDietary(), goals.getFiberTarget());
//
//        // 加权平均
//        return (proteinMatch * 0.3 + fatMatch * 0.2 + carbMatch * 0.3 + fiberMatch * 0.2) * 100;
//    }
//
//    /**
//     * 计算单个营养素的匹配度
//     */
//    private double calculateNutrientMatch(double actual, double target) {
//        if (target == 0) return 1.0; // 如果没有目标，默认完全匹配
//        double ratio = actual / target;
//        // 使用高斯函数计算匹配度，比值越接近1分数越高
//        return Math.exp(-Math.pow(ratio - 1, 2) / 0.5);
//    }
//
//    /**
//     * 计算健康目标匹配度分数
//     */
//    private double calculateHealthScore(Food food, UserProfile profile) {
//        String healthGoal = profile.getHealthData().getHealthGoal();
//        double score = 0.0;
//
//        // 基于健康目标评分
//        switch (healthGoal.toLowerCase()) {
//            case "减重":
//                score = calculateWeightLossScore(food);
//                break;
//            case "增重":
//                score = calculateWeightGainScore(food);
//                break;
//            case "维持":
//                score = calculateMaintenanceScore(food);
//                break;
//            default:
//                score = 50.0; // 默认中等分数
//        }
//
//        // 考虑食物的健康标签
//        score += calculateHealthLabelScore(food);
//
//        return Math.min(score, 100.0); // 确保分数不超过100
//    }
//
//    /**
//     * 计算用户偏好匹配度分数
//     */
//    private double calculatePreferenceScore(Food food, UserProfile profile) {
//        DietaryPreferences preferences = profile.getDietaryPreferences();
//        double score = 0.0;
//
//        // 1. 检查是否在忌口或过敏食物列表中
//        if (preferences.getAvoidFoods().contains(food.getId()) ||
//            preferences.getAllergyFoods().contains(food.getId())) {
//            return 0.0;
//        }
//
//        // 2. 考虑食物类型偏好 (30%)
//        String foodType = food.getType();
//        if (preferences.getFoodTypePreferences().containsKey(foodType)) {
//            score += preferences.getFoodTypePreferences().get(foodType) * 30;
//        }
//
//        // 3. 考虑口味偏好 (30%)
//        String taste = food.getTaste();
//        if (preferences.getTastePreferences().containsKey(taste)) {
//            score += preferences.getTastePreferences().get(taste) * 30;
//        }
//
//        // 4. 考虑历史评分 (40%)
//        double historicalRating = calculateHistoricalRating(food.getId(), profile);
//        score += historicalRating * 40;
//
//        return score;
//    }
//
//    /**
//     * 计算多样性评分
//     */
//    private double calculateDiversityScore(Food food, UserProfile profile) {
//        DietaryPreferences preferences = profile.getDietaryPreferences();
//        Map<Long, Integer> recentFoods = preferences.getFavoriteFoods();
//
//        // 1. 基础多样性分数 (食物未被频繁食用)
//        double baseScore = 100.0;
//        if (recentFoods.containsKey(food.getId())) {
//            int frequency = recentFoods.get(food.getId());
//            baseScore *= Math.exp(-frequency / 10.0); // 频率越高，分数越低
//        }
//
//        // 2. 营养素多样性加分
//        baseScore += calculateNutrientDiversityBonus(food, profile);
//
//        // 3. 食物类型多样性加分
//        baseScore += calculateFoodTypeDiversityBonus(food, profile);
//
//        return Math.min(baseScore, 100.0); // 确保分数不超过100
//    }
//
//    /**
//     * 计算营养素多样性加分
//     */
//    private double calculateNutrientDiversityBonus(Food food, UserProfile profile) {
//        // 实现营养素多样性计算逻辑
//        return 0.0;
//    }
//
//    /**
//     * 计算食物类型多样性加分
//     */
//    private double calculateFoodTypeDiversityBonus(Food food, UserProfile profile) {
//        // 实现食物类型多样性计算逻辑
//        return 0.0;
//    }
//
//    /**
//     * 计算历史评分
//     */
//    private double calculateHistoricalRating(Long foodId, UserProfile profile) {
//        // 实现历史评分计算逻辑
//        return 0.0;
//    }
//
//    /**
//     * 过滤和排序推荐结果
//     */
//    private List<FoodRecommendation> filterAndSortRecommendations(List<FoodRecommendation> recommendations) {
//        return recommendations.stream()
//            .filter(r -> r.getRecommendationScore() >= 60.0) // 只保留60分以上的推荐
//            .sorted(Comparator.comparing(FoodRecommendation::getRecommendationScore).reversed())
//            .collect(Collectors.toList());
//    }
//}