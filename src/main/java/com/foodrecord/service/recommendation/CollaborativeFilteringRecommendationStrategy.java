package com.foodrecord.service.recommendation;

import com.foodrecord.mapper.FoodMapper;
import com.foodrecord.mapper.UserMapper;
import com.foodrecord.ml.entity.UserFoodInteraction;
import com.foodrecord.service.RecommenderService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class CollaborativeFilteringRecommendationStrategy implements RecommendationStrategy {

    private final RecommenderService recommenderService;

    @Autowired
    public CollaborativeFilteringRecommendationStrategy(RecommenderService recommenderService) {
        this.recommenderService = recommenderService;
    }
    @Override
    public List<Long> recommendForUser(Long userId, int numRecommendations) {
        // 获取所有用户对食物的评分或交互数据
        List<UserFoodInteraction> interactions = recommenderService.getFoodInteractionsByUserId(userId);

        // 获取所有食物的交互数据
        Map<Long, List<UserFoodInteraction>> foodInteractions = getAllFoodInteractions();

        // 计算每个食物的相似度
        Map<Long, Double> foodSimilarity = new HashMap<>();
        for (UserFoodInteraction interaction : interactions) {
            Long foodId = interaction.getFoodId();

            // 计算该用户交互过的食物与其它食物的相似度
            double similarity = computeFoodSimilarity(foodId, foodInteractions);
            foodSimilarity.put(foodId, similarity);
        }

        // 排序并返回前 numRecommendations 个推荐食物
        return foodSimilarity.entrySet().stream()
                .sorted(Map.Entry.<Long, Double>comparingByValue().reversed())
                .limit(numRecommendations)
                .map(Map.Entry::getKey)
                .collect(Collectors.toList());
    }
    public double predictRating(Long userId, Long foodId) {
        // 基于物品相似度来预测用户对某个食物的评分
        List<UserFoodInteraction> interactions = recommenderService.getFoodInteractionsByUserId(userId);
        double predictedRating = 0.0;
        double totalSimilarity = 0.0;

        // 获取所有食物的交互数据
        Map<Long, List<UserFoodInteraction>> foodInteractions = getAllFoodInteractions();

        for (UserFoodInteraction interaction : interactions) {

            // 计算当前食物与用户历史交互食物之间的相似度
            double similarity = computeFoodSimilarity(foodId, foodInteractions);
            predictedRating += similarity * interaction.getRating(); // 假设交互数据包含评分
            totalSimilarity += similarity;
        }

        // 避免除以0，返回预测的评分
        return totalSimilarity > 0 ? predictedRating / totalSimilarity : 0.0;
    }

    // 计算两个食物之间的相似度：基于所有食物交互数据
    private double computeFoodSimilarity(Long foodId, Map<Long, List<UserFoodInteraction>> foodInteractions) {
        // 获取当前食物的交互记录
        List<UserFoodInteraction> foodInteractionList = foodInteractions.get(foodId);
        if (foodInteractionList == null) {
            return 0.0;
        }

        double similarity = 0.0;
        // 计算和所有其他食物的相似度
        for (Map.Entry<Long, List<UserFoodInteraction>> entry : foodInteractions.entrySet()) {
            Long otherFoodId = entry.getKey();
            if (!foodId.equals(otherFoodId)) {
                List<UserFoodInteraction> otherFoodInteractions = entry.getValue();
                similarity += computeCosineSimilarity(foodInteractionList, otherFoodInteractions);
            }
        }

        return similarity;
    }

    // 计算余弦相似度
    private double computeCosineSimilarity(List<UserFoodInteraction> foodA, List<UserFoodInteraction> foodB) {
        // 使用Map来存储评分，方便查找
        Map<Long, Double> foodAScores = foodA.stream().collect(Collectors.toMap(UserFoodInteraction::getUserId, UserFoodInteraction::getRating));
        Map<Long, Double> foodBScores = foodB.stream().collect(Collectors.toMap(UserFoodInteraction::getUserId, UserFoodInteraction::getRating));

        // 找出共同评分的用户
        Set<Long> commonUsers = new HashSet<>(foodAScores.keySet());
        commonUsers.retainAll(foodBScores.keySet());

        if (commonUsers.isEmpty()) {
            return 0.0;
        }

        // 计算余弦相似度
        double dotProduct = 0.0;
        double foodASum = 0.0;
        double foodBSum = 0.0;

        for (Long userId : commonUsers) {
            double scoreA = foodAScores.get(userId);
            double scoreB = foodBScores.get(userId);
            dotProduct += scoreA * scoreB;
            foodASum += scoreA * scoreA;
            foodBSum += scoreB * scoreB;
        }

        return dotProduct / (Math.sqrt(foodASum) * Math.sqrt(foodBSum));
    }

    // 获取所有食物的交互数据
    private Map<Long, List<UserFoodInteraction>> getAllFoodInteractions() {
        List<UserFoodInteraction> allInteractions = recommenderService.getUserFoodInteractions();
        return allInteractions.stream().collect(Collectors.groupingBy(UserFoodInteraction::getFoodId));
    }

}
