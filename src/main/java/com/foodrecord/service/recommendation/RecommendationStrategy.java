package com.foodrecord.service.recommendation;

import java.util.List;

public interface RecommendationStrategy {
    List<Long> recommendForUser(Long userId, int numRecommendations);
}
