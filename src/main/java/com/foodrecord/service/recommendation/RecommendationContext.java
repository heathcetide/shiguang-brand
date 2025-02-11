package com.foodrecord.service.recommendation;

import java.util.List;

public class RecommendationContext {

    private RecommendationStrategy recommendationStrategy;

    public void setRecommendationStrategy(RecommendationStrategy recommendationStrategy) {
        this.recommendationStrategy = recommendationStrategy;
    }

    public List<Long> recommend(Long userId, int numRecommendations) {
        return recommendationStrategy.recommendForUser(userId, numRecommendations);
    }
}

