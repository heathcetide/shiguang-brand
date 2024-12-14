package com.foodrecord.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.dto.FoodRecommendationDTO;
import com.foodrecord.model.entity.FoodRecommendation;

import java.util.List;

public interface FoodRecommendationService extends IService<FoodRecommendation> {
    IPage<FoodRecommendation> getPageByUserId(Long userId, String type, int page, int size);

    List<FoodRecommendation> getTopRecommendations(Long userId, String type, Integer limit);

    FoodRecommendation createOrUpdate(FoodRecommendationDTO dto);

    void updateRecommendationScores(Long userId, String type);

    void clearRecommendationCache(Long userId, String type);

    void generateHealthGoalRecommendations(Long userId);

    void generateNutritionBalanceRecommendations(Long userId);
}
