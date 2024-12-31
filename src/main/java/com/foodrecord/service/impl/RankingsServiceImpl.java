package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.mapper.RankingsMapper;
import com.foodrecord.model.dto.RankingsDTO;
import com.foodrecord.model.entity.Rankings;
import com.foodrecord.service.RankingsService;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class RankingsServiceImpl extends ServiceImpl<RankingsMapper, Rankings> implements RankingsService {

    @Override
    public List<Rankings> getByRankType(String rankType, Integer limit) {
        return baseMapper.selectByRankType(rankType, limit);
    }

    @Override
    public Rankings getByFoodIdAndType(Long foodId, String rankType) {
        return baseMapper.selectByFoodIdAndType(foodId, rankType);
    }

    @Override
    @Transactional
    public Rankings createOrUpdate(RankingsDTO dto) {
        Rankings rankings = new Rankings();
        BeanUtils.copyProperties(dto, rankings);
        
        Rankings existing = getByFoodIdAndType(dto.getFoodId(), dto.getRankType());
        if (existing != null) {
            rankings.setId(existing.getId());
            updateById(rankings);
        } else {
            save(rankings);
        }
        return rankings;
    }

    @Override
    @Transactional
    public void updateScore(String rankType, Long foodId, Double score) {
        baseMapper.updateScore(rankType, foodId, score);
    }

    @Override
    public Map<String, List<Rankings>> getMultiTypeRankings(List<String> rankTypes, Integer limit) {
        Map<String, List<Rankings>> result = new HashMap<>();
        for (String rankType : rankTypes) {
            result.put(rankType, getByRankType(rankType, limit));
        }
        return result;
    }

    @Override
    public List<Map<String, Object>> getRankingTrends(String rankType, LocalDateTime startTime, LocalDateTime endTime) {
        return baseMapper.selectRankingTrends(rankType, startTime, endTime);
    }

    @Override
    public List<Map<String, Object>> getFoodRankingHistory(Long foodId, String rankType, LocalDateTime startTime, LocalDateTime endTime) {
        return baseMapper.selectFoodRankingHistory(foodId, rankType, startTime, endTime);
    }

    @Override
    public List<Map<String, Object>> getRankingChanges(String rankType, Integer days, Integer limit) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        return baseMapper.selectRankingTrends(rankType, startTime, LocalDateTime.now());
    }

    @Override
    public List<Rankings> getCategoryRankings(Long categoryId, String rankType, Integer limit) {
        return baseMapper.selectCategoryRankings(categoryId, rankType, limit);
    }

    @Override
    public Map<String, Object> getRankingStats(String rankType) {
        return baseMapper.selectRankingStats(rankType);
    }

    @Override
    public List<Map<String, Object>> getComprehensiveRankings(Integer limit) {
        // 综合多个维度的排名数据
        List<Rankings> popularRankings = getByRankType("POPULAR", limit);
        List<Rankings> ratingRankings = getByRankType("RATING", limit);
        
        // TODO: 实现综合评分算法
        return List.of();
    }

    @Override
    public List<Rankings> getTimePeriodRankings(String rankType, String periodType, Integer limit) {
        return baseMapper.selectTimePeriodRankings(rankType, periodType, limit);
    }

    @Override
    public List<Rankings> getRegionRankings(String regionCode, String rankType, Integer limit) {
        return baseMapper.selectRegionRankings(regionCode, rankType, limit);
    }

    @Override
    public List<Rankings> getSeasonalRankings(String rankType, String season, Integer limit) {
        return baseMapper.selectSeasonalRankings(rankType, season, limit);
    }

    @Override
    public List<Rankings> getUserPreferenceRankings(Long userId, Integer limit) {
        return baseMapper.selectUserPreferenceRankings(userId, limit);
    }

    @Override
    public List<Rankings> getNutritionRankings(String nutritionType, Integer limit) {
        return baseMapper.selectNutritionRankings(nutritionType, limit);
    }

    @Override
    public List<Rankings> getPriceRangeRankings(Double minPrice, Double maxPrice, String rankType, Integer limit) {
        return baseMapper.selectPriceRangeRankings(minPrice, maxPrice, rankType, limit);
    }

    @Override
    public List<Rankings> getRatingRangeRankings(Double minRating, Double maxRating, Integer limit) {
        return baseMapper.selectRatingRangeRankings(minRating, maxRating, limit);
    }

    @Override
    public List<Rankings> getNewItemRankings(Integer days, String rankType, Integer limit) {
        return baseMapper.selectNewItemRankings(days, rankType, limit);
    }

    @Override
    public List<Rankings> getTagRankings(String tagName, String rankType, Integer limit) {
        return baseMapper.selectTagRankings(tagName, rankType, limit);
    }

    @Override
    public List<Rankings> getTrendingRankings(Integer hours, Integer limit) {
        return baseMapper.selectTrendingRankings(hours, limit);
    }

    @Override
    public List<Rankings> getSceneBasedRankings(String sceneType, Integer limit) {
        return baseMapper.selectSceneBasedRankings(sceneType, limit);
    }

    @Override
    public List<Rankings> getHealthyFoodRankings(String healthType, Integer limit) {
        return baseMapper.selectHealthyFoodRankings(healthType, limit);
    }

    @Override
    public List<Rankings> getDietaryRankings(String dietaryType, Integer limit) {
        return baseMapper.selectDietaryRankings(dietaryType, limit);
    }

    @Override
    public List<Rankings> getFestivalRankings(String festivalType, Integer limit) {
        return baseMapper.selectFestivalRankings(festivalType, limit);
    }

    @Override
    public List<Rankings> getTastePreferenceRankings(String tasteType, Integer limit) {
        return baseMapper.selectTastePreferenceRankings(tasteType, limit);
    }

    @Override
    public List<Rankings> getCookingMethodRankings(String cookingMethod, Integer limit) {
        return baseMapper.selectCookingMethodRankings(cookingMethod, limit);
    }

    @Override
    public List<Rankings> getIngredientRankings(String ingredientType, Integer limit) {
        return baseMapper.selectIngredientRankings(ingredientType, limit);
    }

    @Override
    public List<Rankings> getAgeGroupRankings(String ageGroup, Integer limit) {
        return baseMapper.selectAgeGroupRankings(ageGroup, limit);
    }

    @Override
    public List<Rankings> getRestaurantTypeRankings(String restaurantType, Integer limit) {
        return baseMapper.selectRestaurantTypeRankings(restaurantType, limit);
    }

    @Override
    public List<Rankings> getTakeawayRankings(String sortType, Integer limit) {
        return baseMapper.selectTakeawayRankings(sortType, limit);
    }

    @Override
    public List<Rankings> getValueForMoneyRankings(String priceRange, Integer limit) {
        return baseMapper.selectValueForMoneyRankings(priceRange, limit);
    }

    @Override
    public List<Rankings> getInnovativeDishRankings(String innovationType, Integer limit) {
        return baseMapper.selectInnovativeDishRankings(innovationType, limit);
    }

    @Override
    public List<Rankings> getSolarTermRankings(String solarTerm, Integer limit) {
        return baseMapper.selectSolarTermRankings(solarTerm, limit);
    }

    @Override
    public List<Rankings> getMustOrderRankings(Long restaurantId, Integer limit) {
        return baseMapper.selectMustOrderRankings(restaurantId, limit);
    }

    @Override
    public List<Rankings> getPhotoCheckInRankings(Integer days, Integer limit) {
        return baseMapper.selectPhotoCheckInRankings(days, limit);
    }

    @Override
    public List<Rankings> getLateNightRankings(Integer limit) {
        return baseMapper.selectLateNightRankings(limit);
    }

    @Override
    public List<Rankings> getBreakfastRankings(String sortType, Integer limit) {
        return baseMapper.selectBreakfastRankings(sortType, limit);
    }

    @Override
    public List<Rankings> getAfternoonTeaRankings(String type, Integer limit) {
        return baseMapper.selectAfternoonTeaRankings(type, limit);
    }

    @Override
    public List<Rankings> getGatheringRankings(String gatheringType, Integer peopleCount, Integer limit) {
        return baseMapper.selectGatheringRankings(gatheringType, peopleCount, limit);
    }
} 