package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.Rankings;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Mapper
public interface RankingsMapper extends BaseMapper<Rankings> {
    /**
     * 根据排名类型获取排行榜
     */
    List<Rankings> selectByRankType(@Param("rankType") String rankType, @Param("limit") Integer limit);

    /**
     * 根据食物ID和排名类型获取排名
     */
    Rankings selectByFoodIdAndType(@Param("foodId") Long foodId, @Param("rankType") String rankType);

    /**
     * 更新排名分数
     */
    void updateScore(@Param("rankType") String rankType, @Param("foodId") Long foodId, @Param("score") Double score);

    /**
     * 获取排行榜变化趋势
     */
    List<Map<String, Object>> selectRankingTrends(@Param("rankType") String rankType, 
                                                 @Param("startTime") LocalDateTime startTime,
                                                 @Param("endTime") LocalDateTime endTime);

    /**
     * 获取食物的历史排名记录
     */
    List<Map<String, Object>> selectFoodRankingHistory(@Param("foodId") Long foodId,
                                                      @Param("rankType") String rankType,
                                                      @Param("startTime") LocalDateTime startTime,
                                                      @Param("endTime") LocalDateTime endTime);

    /**
     * 获取类别排行榜
     */
    List<Rankings> selectCategoryRankings(@Param("categoryId") Long categoryId,
                                        @Param("rankType") String rankType,
                                        @Param("limit") Integer limit);

    /**
     * 获取排行榜统计信息
     */
    Map<String, Object> selectRankingStats(@Param("rankType") String rankType);

    /**
     * 获取时段热门排行
     */
    List<Rankings> selectTimePeriodRankings(@Param("rankType") String rankType,
                                          @Param("periodType") String periodType,
                                          @Param("limit") Integer limit);

    /**
     * 获取区域排行榜
     */
    List<Rankings> selectRegionRankings(@Param("regionCode") String regionCode,
                                      @Param("rankType") String rankType,
                                      @Param("limit") Integer limit);

    /**
     * 获取季节性排行榜
     */
    List<Rankings> selectSeasonalRankings(@Param("rankType") String rankType,
                                        @Param("season") String season,
                                        @Param("limit") Integer limit);

    /**
     * 获取用户偏好排行
     */
    List<Rankings> selectUserPreferenceRankings(@Param("userId") Long userId,
                                              @Param("limit") Integer limit);

    /**
     * 获取营养价值排行
     */
    List<Rankings> selectNutritionRankings(@Param("nutritionType") String nutritionType,
                                         @Param("limit") Integer limit);

    /**
     * 获取价格区间排行
     */
    List<Rankings> selectPriceRangeRankings(@Param("minPrice") Double minPrice,
                                          @Param("maxPrice") Double maxPrice,
                                          @Param("rankType") String rankType,
                                          @Param("limit") Integer limit);

    /**
     * 获取评分区间排行
     */
    List<Rankings> selectRatingRangeRankings(@Param("minRating") Double minRating,
                                           @Param("maxRating") Double maxRating,
                                           @Param("limit") Integer limit);

    /**
     * 获取新品排行
     */
    List<Rankings> selectNewItemRankings(@Param("days") Integer days,
                                       @Param("rankType") String rankType,
                                       @Param("limit") Integer limit);

    /**
     * 获取标签排行
     */
    List<Rankings> selectTagRankings(@Param("tagName") String tagName,
                                   @Param("rankType") String rankType,
                                   @Param("limit") Integer limit);

    /**
     * 获取热度上升最快排行
     */
    List<Rankings> selectTrendingRankings(@Param("hours") Integer hours,
                                        @Param("limit") Integer limit);

    /**
     * 获取特定场景下的推荐排行
     */
    List<Rankings> selectSceneBasedRankings(@Param("sceneType") String sceneType,
                                          @Param("limit") Integer limit);

    /**
     * 获取健康饮食排行
     */
    List<Rankings> selectHealthyFoodRankings(@Param("healthType") String healthType,
                                           @Param("limit") Integer limit);

    /**
     * 获取特殊饮食需求排行
     */
    List<Rankings> selectDietaryRankings(@Param("dietaryType") String dietaryType,
                                       @Param("limit") Integer limit);

    /**
     * 获取节日特色排行
     */
    List<Rankings> selectFestivalRankings(@Param("festivalType") String festivalType,
                                        @Param("limit") Integer limit);

    /**
     * 获取口味偏好排行
     */
    List<Rankings> selectTastePreferenceRankings(@Param("tasteType") String tasteType,
                                               @Param("limit") Integer limit);

    /**
     * 获取烹饪方式排行
     */
    List<Rankings> selectCookingMethodRankings(@Param("cookingMethod") String cookingMethod,
                                             @Param("limit") Integer limit);

    /**
     * 获取食材排行
     */
    List<Rankings> selectIngredientRankings(@Param("ingredientType") String ingredientType,
                                          @Param("limit") Integer limit);

    /**
     * 获取年龄段偏好排行
     */
    List<Rankings> selectAgeGroupRankings(@Param("ageGroup") String ageGroup,
                                        @Param("limit") Integer limit);

    /**
     * 获取餐厅类型排行
     */
    List<Rankings> selectRestaurantTypeRankings(@Param("restaurantType") String restaurantType,
                                              @Param("limit") Integer limit);

    /**
     * 获取外卖排行
     */
    List<Rankings> selectTakeawayRankings(@Param("sortType") String sortType,
                                        @Param("limit") Integer limit);

    /**
     * 获取性价比排行
     */
    List<Rankings> selectValueForMoneyRankings(@Param("priceRange") String priceRange,
                                             @Param("limit") Integer limit);

    /**
     * 获取创新菜品排行
     */
    List<Rankings> selectInnovativeDishRankings(@Param("innovationType") String innovationType,
                                              @Param("limit") Integer limit);

    /**
     * 获取节气美食排行
     */
    List<Rankings> selectSolarTermRankings(@Param("solarTerm") String solarTerm,
                                         @Param("limit") Integer limit);

    /**
     * 获取进店必点排行
     */
    List<Rankings> selectMustOrderRankings(@Param("restaurantId") Long restaurantId,
                                         @Param("limit") Integer limit);

    /**
     * 获取拍照打卡排行
     */
    List<Rankings> selectPhotoCheckInRankings(@Param("days") Integer days,
                                            @Param("limit") Integer limit);

    /**
     * 获取深夜食堂排行
     */
    List<Rankings> selectLateNightRankings(@Param("limit") Integer limit);

    /**
     * 获取早餐排行
     */
    List<Rankings> selectBreakfastRankings(@Param("sortType") String sortType,
                                         @Param("limit") Integer limit);

    /**
     * 获取下午茶排行
     */
    List<Rankings> selectAfternoonTeaRankings(@Param("type") String type,
                                            @Param("limit") Integer limit);

    /**
     * 获取聚会推荐排行
     */
    List<Rankings> selectGatheringRankings(@Param("gatheringType") String gatheringType,
                                         @Param("peopleCount") Integer peopleCount,
                                         @Param("limit") Integer limit);
} 