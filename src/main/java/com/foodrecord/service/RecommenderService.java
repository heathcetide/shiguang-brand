package com.foodrecord.service;

import java.util.List;

public interface RecommenderService {

    void trainModel();

    List<Long> recommendForUser(Long userId, int numRecommendations);

    double predictRating(Long userId, Long foodId);

    void saveModel(String path);

    void loadModel(String path);
} 