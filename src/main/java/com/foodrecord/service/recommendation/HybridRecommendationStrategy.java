//package com.foodrecord.service.recommendation;
//
//import java.util.LinkedHashSet;
//import java.util.List;
//import java.util.Set;
//import java.util.stream.Collectors;
//
//public class HybridRecommendationStrategy implements RecommendationStrategy {
//
//    private RecommendationStrategy collaborativeFilteringStrategy;
//    private RecommendationStrategy contentBasedStrategy;
//    private RecommendationStrategy popularityBasedStrategy;
//
//    public HybridRecommendationStrategy() {
//        this.collaborativeFilteringStrategy = new CollaborativeFilteringRecommendationStrategy();
////        this.contentBasedStrategy = new ContentBasedRecommendationStrategy();
//        this.popularityBasedStrategy = new PopularityBasedRecommendationStrategy();
//    }
//
//    @Override
//    public List<Long> recommendForUser(Long userId, int numRecommendations) {
//        // 组合不同的推荐结果，取联合推荐的前几个
//        List<Long> collaborativeRecommendations = collaborativeFilteringStrategy.recommendForUser(userId, numRecommendations);
//        List<Long> contentBasedRecommendations = contentBasedStrategy.recommendForUser(userId, numRecommendations);
//        List<Long> popularityRecommendations = popularityBasedStrategy.recommendForUser(userId, numRecommendations);
//
//        // 将所有推荐合并，去重并排序
//        Set<Long> recommendedFoodIds = new LinkedHashSet<>();
//        recommendedFoodIds.addAll(collaborativeRecommendations);
//        recommendedFoodIds.addAll(contentBasedRecommendations);
//        recommendedFoodIds.addAll(popularityRecommendations);
//
//        return recommendedFoodIds.stream()
//                .limit(numRecommendations)
//                .collect(Collectors.toList());
//    }
//
//    @Override
//    public double predictRating(Long userId, Long foodId) {
//        // 可以根据不同方法的加权来预测评分
//        return 0.0; // 简化的实现
//    }
//}
