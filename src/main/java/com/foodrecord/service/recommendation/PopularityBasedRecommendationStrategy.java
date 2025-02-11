//package com.foodrecord.service.recommendation;
//
//import com.foodrecord.mapper.FoodMapper;
//import com.foodrecord.model.entity.Food;
//
//import java.util.Comparator;
//import java.util.List;
//import java.util.stream.Collectors;
//
//public class PopularityBasedRecommendationStrategy implements RecommendationStrategy {
//
//    private FoodMapper foodMapper;
//
//    @Override
//    public List<Long> recommendForUser(Long userId, int numRecommendations) {
////        // 获取所有食物并按流行度排序，假设我们有一个方法可以获取食物的流行度
////        List<Food> allFoods = foodMapper.getAllFoods();
////
////        return allFoods.stream()
////                .sorted(Comparator.comparingInt(Food::getPopularity).reversed())
////                .limit(numRecommendations)
////                .map(Food::getId)
////                .collect(Collectors.toList());
//        return null;
//    }
//
//    @Override
//    public double predictRating(Long userId, Long foodId) {
//        // 基于流行度的评分预测（假设流行度高的食物评分较高）
//        return 0.0; // 简化的实现
//    }
//}
