package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.common.utils.RedisUtils;
import com.foodrecord.mapper.FoodRecommendationMapper;
import com.foodrecord.model.dto.FoodRecommendationDTO;
import com.foodrecord.model.entity.FoodRecommendation;
import com.foodrecord.service.FoodRecommendationService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class FoodRecommendationServiceImpl extends ServiceImpl<FoodRecommendationMapper, FoodRecommendation> implements FoodRecommendationService {

    private final FoodRecommendationMapper recommendationMapper;
    private final RedisUtils redisUtils;
    
    private static final String RECOMMENDATION_CACHE_KEY = "recommendation:";
    private static final long CACHE_TIME = 3600; // 1小时

    public FoodRecommendationServiceImpl(FoodRecommendationMapper recommendationMapper, RedisUtils redisUtils) {
        this.recommendationMapper = recommendationMapper;
        this.redisUtils = redisUtils;
    }

    public IPage<FoodRecommendation> getPageByUserId(Long userId, String type, int page, int size) {
        return recommendationMapper.selectPageByUserId(new Page<>(page, size), userId, type);
    }

    public List<FoodRecommendation> getTopRecommendations(Long userId, String type, Integer limit) {
        String key = RECOMMENDATION_CACHE_KEY + userId + ":" + type + ":" + limit;
        Object cached = redisUtils.get(key);
        if (cached != null) {
            return (List<FoodRecommendation>) cached;
        }
        
        List<FoodRecommendation> recommendations = recommendationMapper.selectTopRecommendations(userId, type, limit);
        redisUtils.set(key, recommendations, CACHE_TIME);
        return recommendations;
    }

    @Transactional
    public FoodRecommendation createOrUpdate(FoodRecommendationDTO dto) {
        FoodRecommendation recommendation = new FoodRecommendation();
        recommendation.setUserId(dto.getUserId());
        recommendation.setFoodId(dto.getFoodId());
        recommendation.setRecommendationType(dto.getRecommendationType());
        recommendation.setRecommendationScore(dto.getRecommendationScore());
        recommendation.setReason(dto.getReason());
        
        saveOrUpdate(recommendation);
        
        // 清除相关缓存
        clearRecommendationCache(dto.getUserId(), dto.getRecommendationType());
        
        return recommendation;
    }

    @Transactional
    public void updateRecommendationScores(Long userId, String type) {
        recommendationMapper.updateRecommendationScores(userId, type);
        clearRecommendationCache(userId, type);
    }

    public void clearRecommendationCache(Long userId, String type) {
        redisUtils.delete(RECOMMENDATION_CACHE_KEY + userId + ":" + type + ":*");
    }

    // 根据用户健康目标生成推荐
    @Transactional
    public void generateHealthGoalRecommendations(Long userId) {
        // 删除旧的健康目标推荐
        lambdaUpdate()
            .eq(FoodRecommendation::getUserId, userId)
            .eq(FoodRecommendation::getRecommendationType, "HEALTH_GOAL")
            .remove();
        
        // 更新推荐分数
        updateRecommendationScores(userId, "HEALTH_GOAL");
    }

    // 根据营养均衡生成推荐
    @Transactional
    public void generateNutritionBalanceRecommendations(Long userId) {
        // 删除旧的营养均衡推荐
        lambdaUpdate()
            .eq(FoodRecommendation::getUserId, userId)
            .eq(FoodRecommendation::getRecommendationType, "NUTRITION_BALANCE")
            .remove();
        
        // 更新推荐分数
        updateRecommendationScores(userId, "NUTRITION_BALANCE");
    }
} 