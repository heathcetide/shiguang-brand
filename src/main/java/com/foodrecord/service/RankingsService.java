package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.dto.RankingsDTO;
import com.foodrecord.model.entity.Rankings;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 排行榜服务接口
 */
public interface RankingsService extends IService<Rankings> {
    /**
     * 获取指定类型的排行榜
     */
    List<Rankings> getByRankType(String rankType, Integer limit);

    /**
     * 获取食物在特定类型排行榜中的排名
     */
    Rankings getByFoodIdAndType(Long foodId, String rankType);

    /**
     * 创建或更新排名记录
     */
    Rankings createOrUpdate(RankingsDTO dto);

    /**
     * 更新排名分数
     */
    void updateScore(String rankType, Long foodId, Double score);

    /**
     * 获取多个类型的排行榜
     */
    Map<String, List<Rankings>> getMultiTypeRankings(List<String> rankTypes, Integer limit);

    /**
     * 获取排行榜变化趋势
     */
    List<Map<String, Object>> getRankingTrends(String rankType, LocalDateTime startTime, LocalDateTime endTime);

    /**
     * 获取食物的历史排名记录
     */
    List<Map<String, Object>> getFoodRankingHistory(Long foodId, String rankType, LocalDateTime startTime, LocalDateTime endTime);

    /**
     * 获取排行榜前后变化
     */
    List<Map<String, Object>> getRankingChanges(String rankType, Integer days, Integer limit);

    /**
     * 获取类别排行榜
     */
    List<Rankings> getCategoryRankings(Long categoryId, String rankType, Integer limit);

    /**
     * 获取排行榜统计信息
     */
    Map<String, Object> getRankingStats(String rankType);

    /**
     * 获取综合排名
     */
    List<Map<String, Object>> getComprehensiveRankings(Integer limit);

    /**
     * 获取时段热门排行
     */
    List<Rankings> getTimePeriodRankings(String rankType, String periodType, Integer limit);

    /**
     * 获取区域排行榜
     */
    List<Rankings> getRegionRankings(String regionCode, String rankType, Integer limit);

    /**
     * 获取季节性排行榜
     */
    List<Rankings> getSeasonalRankings(String rankType, String season, Integer limit);

    /**
     * 获取用户偏好排行
     */
    List<Rankings> getUserPreferenceRankings(Long userId, Integer limit);

    /**
     * 获取营养价值排行
     */
    List<Rankings> getNutritionRankings(String nutritionType, Integer limit);

    /**
     * 获取价格区间排行
     */
    List<Rankings> getPriceRangeRankings(Double minPrice, Double maxPrice, String rankType, Integer limit);

    /**
     * 获取评分区间排行
     */
    List<Rankings> getRatingRangeRankings(Double minRating, Double maxRating, Integer limit);

    /**
     * 获取新品排行
     */
    List<Rankings> getNewItemRankings(Integer days, String rankType, Integer limit);

    /**
     * 获取标签排行
     */
    List<Rankings> getTagRankings(String tagName, String rankType, Integer limit);

    /**
     * 获取热度上升最快排行
     */
    List<Rankings> getTrendingRankings(Integer hours, Integer limit);

    /**
     * 获取特定场景下的推荐排行
     */
    List<Rankings> getSceneBasedRankings(String sceneType, Integer limit);

    /**
     * 获取健康饮食排行
     */
    List<Rankings> getHealthyFoodRankings(String healthType, Integer limit);

    /**
     * 获取特殊饮食需求排行
     */
    List<Rankings> getDietaryRankings(String dietaryType, Integer limit);

    /**
     * 获取节日特色排行
     */
    List<Rankings> getFestivalRankings(String festivalType, Integer limit);

    /**
     * 获取口味偏好排行
     */
    List<Rankings> getTastePreferenceRankings(String tasteType, Integer limit);

    /**
     * 获取烹饪方式排行
     */
    List<Rankings> getCookingMethodRankings(String cookingMethod, Integer limit);

    /**
     * 获取食材排行
     */
    List<Rankings> getIngredientRankings(String ingredientType, Integer limit);

    /**
     * 获取年龄段偏好排行
     */
    List<Rankings> getAgeGroupRankings(String ageGroup, Integer limit);

    /**
     * 获取餐厅类型排行
     */
    List<Rankings> getRestaurantTypeRankings(String restaurantType, Integer limit);

    /**
     * 获取外卖排行
     */
    List<Rankings> getTakeawayRankings(String sortType, Integer limit);

    /**
     * 获取性价比排行
     */
    List<Rankings> getValueForMoneyRankings(String priceRange, Integer limit);

    /**
     * 获取创新菜品排行
     */
    List<Rankings> getInnovativeDishRankings(String innovationType, Integer limit);

    /**
     * 获取节气美食排行
     */
    List<Rankings> getSolarTermRankings(String solarTerm, Integer limit);

    /**
     * 获取进店必点排行
     */
    List<Rankings> getMustOrderRankings(Long restaurantId, Integer limit);

    /**
     * 获取拍照打卡排行
     */
    List<Rankings> getPhotoCheckInRankings(Integer days, Integer limit);

    /**
     * 获取深夜食堂排行
     */
    List<Rankings> getLateNightRankings(Integer limit);

    /**
     * 获取早餐排行
     */
    List<Rankings> getBreakfastRankings(String sortType, Integer limit);

    /**
     * 获取下午茶排行
     */
    List<Rankings> getAfternoonTeaRankings(String type, Integer limit);

    /**
     * 获取聚会推荐排行
     */
    List<Rankings> getGatheringRankings(String gatheringType, Integer peopleCount, Integer limit);
}
