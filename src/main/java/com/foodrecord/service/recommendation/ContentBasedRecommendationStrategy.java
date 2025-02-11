//package com.foodrecord.service.recommendation;
//
//import com.foodrecord.ml.feature.FoodFeature;
//import com.foodrecord.mapper.FoodMapper;
//import com.foodrecord.service.FoodService;
//import org.springframework.stereotype.Service;
//
//import java.util.*;
//import java.util.stream.Collectors;
//
//@Service
//public class ContentBasedRecommendationStrategy implements RecommendationStrategy {
//
//    private final FoodService foodService;
//
//    // 注入FoodService或数据库相关的服务
//    public ContentBasedRecommendationStrategy(FoodService foodService) {
//        this.foodService = foodService;
//    }
//
//    @Override
//    public List<Long> recommendForUser(Long userId, int numRecommendations) {
//        // 获取用户历史喜欢的食物
//        List<Long> likedFoodIds = getUserLikedFood(userId);
//
//        // 获取食物的特征，假设食物特征包含种类、口味、材料等
//        Map<Long, FoodFeature> foodFeatures = getFoodFeatures(likedFoodIds);
//
//        // 基于内容的推荐：通过分析用户喜欢的食物的特征，推荐相似的食物
//        return foodFeatures.entrySet().stream()
//                .sorted(Map.Entry.<Long, FoodFeature>comparingByValue(Comparator.comparingDouble(this::calculateContentSimilarity)))
//                .limit(numRecommendations)
//                .map(Map.Entry::getKey)
//                .collect(Collectors.toList());
//    }
//
//    @Override
//    public double predictRating(Long userId, Long foodId) {
//        // 基于内容的评分预测
//        List<Long> likedFoodIds = getUserLikedFood(userId);
//        Map<Long, FoodFeature> foodFeatures = getFoodFeatures(likedFoodIds);
//
//        // 计算给定食物与用户历史喜好食物的相似度
//        double predictedRating = 0.0;
//        double totalSimilarity = 0.0;
//
//        for (Long likedFoodId : likedFoodIds) {
//            FoodFeature likedFoodFeature = foodFeatures.get(likedFoodId);
//            double similarity = calculateContentSimilarity(likedFoodFeature);
//            predictedRating += similarity;  // 假设用户评分是基于相似度的
//            totalSimilarity += similarity;
//        }
//
//        return totalSimilarity > 0 ? predictedRating / totalSimilarity : 0.0;
//    }
//
//    private List<Long> getUserLikedFood(Long userId) {
//        // 从数据库或缓存中获取用户喜欢的食物列表
//        // 示例：这里返回一个假的食物 ID 列表，实际需要查询数据库
//        return foodService.getLikedFoodByUserId(userId);
//    }
//
//    // 假设使用Redis作为缓存
//    private Map<Long, FoodFeature> getFoodFeatures(List<Long> foodIds) {
//        // 检查缓存中是否有食物特征
//        Map<Long, FoodFeature> foodFeatures = new HashMap<>();
//        for (Long foodId : foodIds) {
//            FoodFeature foodFeature = redisCache.get("food:" + foodId);
//            if (foodFeature != null) {
//                foodFeatures.put(foodId, foodFeature);
//            } else {
//                // 如果缓存没有，查询数据库并缓存结果
//                foodFeature = foodService.getFoodFeatureById(foodId);
//                redisCache.set("food:" + foodId, foodFeature);
//                foodFeatures.put(foodId, foodFeature);
//            }
//        }
//        return foodFeatures;
//    }
//
//
//    private double calculateContentSimilarity(FoodFeature foodFeature) {
//        // 根据内容的相似度计算方式进行匹配
//        // 假设我们使用余弦相似度计算食物特征之间的相似性
//        return foodFeature.getFlavorScore() * Math.random();  // 这里只是一个简化的实现
//    }
//}
