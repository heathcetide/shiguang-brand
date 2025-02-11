package com.foodrecord.service;

import com.foodrecord.ml.entity.UserFoodInteraction;

import java.util.List;

public interface RecommenderService {

    void trainModel();

    List<Long> recommendForUser(Long userId, int numRecommendations);

    double predictRating(Long userId, Long foodId);

    void saveModel(String path);

    void loadModel(String path);

    List<UserFoodInteraction> getUserFoodInteractions();

    List<UserFoodInteraction> getFoodInteractionsByUserId(Long userId);

    List<Long> getAllInteractedFoodIds();
}