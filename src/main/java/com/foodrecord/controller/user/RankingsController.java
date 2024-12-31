package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.RankingsDTO;
import com.foodrecord.model.entity.Rankings;
import com.foodrecord.service.RankingsService;
import com.foodrecord.service.impl.RankingsServiceImpl;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/rankings")
@Api(tags = "排行榜模块")
public class RankingsController {
    private final RankingsService rankingsService;

    public RankingsController(RankingsServiceImpl rankingsService) {
        this.rankingsService = rankingsService;
    }

    @ApiOperation("获取指定类型的排行榜")
    @GetMapping("/{rankType}")
    public ApiResponse<List<Rankings>> getByRankType(
            @ApiParam(value = "排名类型", example = "POPULAR") @PathVariable String rankType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getByRankType(rankType, limit));
    }

    @ApiOperation("获取食物在特定类型排行榜中的排名")
    @GetMapping("/food/{foodId}/{rankType}")
    public ApiResponse<Rankings> getByFoodIdAndType(
            @ApiParam(value = "食物ID", example = "1") @PathVariable Long foodId,
            @ApiParam(value = "排名类型", example = "POPULAR") @PathVariable String rankType) {
        return ApiResponse.success(rankingsService.getByFoodIdAndType(foodId, rankType));
    }

    @ApiOperation("创建或更新排名记录")
    @PostMapping
    public ApiResponse<Rankings> createOrUpdate(@Valid @RequestBody RankingsDTO dto) {
        return ApiResponse.success(rankingsService.createOrUpdate(dto));
    }

    @ApiOperation("更新排名分数")
    @PutMapping("/{rankType}/{foodId}/score")
    public ApiResponse<Boolean> updateScore(
            @ApiParam(value = "排名类型", example = "POPULAR") @PathVariable String rankType,
            @ApiParam(value = "食物ID", example = "1") @PathVariable Long foodId,
            @ApiParam(value = "新的分数", example = "4.8") @RequestParam Double score) {
        rankingsService.updateScore(rankType, foodId, score);
        return ApiResponse.success(true);
    }

    @ApiOperation("获取多个类型的排行榜")
    @GetMapping("/multi-type")
    public ApiResponse<Map<String, List<Rankings>>> getMultiTypeRankings(
            @ApiParam(value = "排名类型列表", example = "POPULAR,RATING") @RequestParam List<String> rankTypes,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getMultiTypeRankings(rankTypes, limit));
    }

    @ApiOperation("获取排行榜变化趋势")
    @GetMapping("/{rankType}/trends")
    public ApiResponse<List<Map<String, Object>>> getRankingTrends(
            @ApiParam(value = "排名类型", example = "POPULAR") @PathVariable String rankType,
            @ApiParam(value = "开始时间") @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime startTime,
            @ApiParam(value = "结束时间") @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime endTime) {
        return ApiResponse.success(rankingsService.getRankingTrends(rankType, startTime, endTime));
    }

    @ApiOperation("获取食物的历史排名记录")
    @GetMapping("/food/{foodId}/history")
    public ApiResponse<List<Map<String, Object>>> getFoodRankingHistory(
            @ApiParam(value = "食物ID", example = "1") @PathVariable Long foodId,
            @ApiParam(value = "排名类型", example = "POPULAR") @RequestParam(required = false) String rankType,
            @ApiParam(value = "开始时间") @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime startTime,
            @ApiParam(value = "结束时间") @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime endTime) {
        return ApiResponse.success(rankingsService.getFoodRankingHistory(foodId, rankType, startTime, endTime));
    }

    @ApiOperation("获取排行榜前后变化")
    @GetMapping("/{rankType}/changes")
    public ApiResponse<List<Map<String, Object>>> getRankingChanges(
            @ApiParam(value = "排名类型", example = "POPULAR") @PathVariable String rankType,
            @ApiParam(value = "对比天数", example = "7") @RequestParam(defaultValue = "7") Integer days,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getRankingChanges(rankType, days, limit));
    }

    @ApiOperation("获取类别排行榜")
    @GetMapping("/category/{categoryId}")
    public ApiResponse<List<Rankings>> getCategoryRankings(
            @ApiParam(value = "类别ID", example = "1") @PathVariable Long categoryId,
            @ApiParam(value = "排名类型", example = "POPULAR") @RequestParam String rankType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getCategoryRankings(categoryId, rankType, limit));
    }

    @ApiOperation("获取排行榜统计信息")
    @GetMapping("/{rankType}/stats")
    public ApiResponse<Map<String, Object>> getRankingStats(
            @ApiParam(value = "排名类型", example = "POPULAR") @PathVariable String rankType) {
        return ApiResponse.success(rankingsService.getRankingStats(rankType));
    }

    @ApiOperation("获取综合排名")
    @GetMapping("/comprehensive")
    public ApiResponse<List<Map<String, Object>>> getComprehensiveRankings(
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getComprehensiveRankings(limit));
    }

    @ApiOperation("获取时段热门排行")
    @GetMapping("/time-period")
    public ApiResponse<List<Rankings>> getTimePeriodRankings(
            @ApiParam(value = "排名类型", example = "POPULAR") @RequestParam String rankType,
            @ApiParam(value = "时段类型(MORNING/NOON/EVENING)", example = "MORNING") @RequestParam String periodType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getTimePeriodRankings(rankType, periodType, limit));
    }

    @ApiOperation("获取区域排行榜")
    @GetMapping("/region/{regionCode}")
    public ApiResponse<List<Rankings>> getRegionRankings(
            @ApiParam(value = "区域代码", example = "330100") @PathVariable String regionCode,
            @ApiParam(value = "排名类型", example = "POPULAR") @RequestParam String rankType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getRegionRankings(regionCode, rankType, limit));
    }

    @ApiOperation("获取季节性排行榜")
    @GetMapping("/seasonal")
    public ApiResponse<List<Rankings>> getSeasonalRankings(
            @ApiParam(value = "排名类型", example = "POPULAR") @RequestParam String rankType,
            @ApiParam(value = "季节(SPRING/SUMMER/AUTUMN/WINTER)", example = "SUMMER") @RequestParam String season,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getSeasonalRankings(rankType, season, limit));
    }

    @ApiOperation("获取用户偏好排行")
    @GetMapping("/user-preference/{userId}")
    public ApiResponse<List<Rankings>> getUserPreferenceRankings(
            @ApiParam(value = "用户ID", example = "1") @PathVariable Long userId,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getUserPreferenceRankings(userId, limit));
    }

    @ApiOperation("获取营养价值排行")
    @GetMapping("/nutrition")
    public ApiResponse<List<Rankings>> getNutritionRankings(
            @ApiParam(value = "营养类型(PROTEIN/VITAMIN/FIBER等)", example = "PROTEIN") @RequestParam String nutritionType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getNutritionRankings(nutritionType, limit));
    }

    @ApiOperation("获取价格区间排行")
    @GetMapping("/price-range")
    public ApiResponse<List<Rankings>> getPriceRangeRankings(
            @ApiParam(value = "最小价格", example = "0") @RequestParam Double minPrice,
            @ApiParam(value = "最大价格", example = "100") @RequestParam Double maxPrice,
            @ApiParam(value = "排名类型", example = "POPULAR") @RequestParam String rankType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getPriceRangeRankings(minPrice, maxPrice, rankType, limit));
    }

    @ApiOperation("获取评分区间排行")
    @GetMapping("/rating-range")
    public ApiResponse<List<Rankings>> getRatingRangeRankings(
            @ApiParam(value = "最小评分", example = "4.0") @RequestParam Double minRating,
            @ApiParam(value = "最大评分", example = "5.0") @RequestParam Double maxRating,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getRatingRangeRankings(minRating, maxRating, limit));
    }

    @ApiOperation("获取新品排行")
    @GetMapping("/new-items")
    public ApiResponse<List<Rankings>> getNewItemRankings(
            @ApiParam(value = "天数范围", example = "30") @RequestParam(defaultValue = "30") Integer days,
            @ApiParam(value = "排名类型", example = "POPULAR") @RequestParam String rankType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getNewItemRankings(days, rankType, limit));
    }

    @ApiOperation("获取标签排行")
    @GetMapping("/tag/{tagName}")
    public ApiResponse<List<Rankings>> getTagRankings(
            @ApiParam(value = "标签名称", example = "素食") @PathVariable String tagName,
            @ApiParam(value = "排名类型", example = "POPULAR") @RequestParam String rankType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getTagRankings(tagName, rankType, limit));
    }

    @ApiOperation("获取热度上升最快排行")
    @GetMapping("/trending")
    public ApiResponse<List<Rankings>> getTrendingRankings(
            @ApiParam(value = "时间范围(小时)", example = "24") @RequestParam(defaultValue = "24") Integer hours,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getTrendingRankings(hours, limit));
    }

    @ApiOperation("获取特定场景下的推荐排行")
    @GetMapping("/scene")
    public ApiResponse<List<Rankings>> getSceneBasedRankings(
            @ApiParam(value = "场景类型(BREAKFAST/LUNCH/DINNER/PARTY/MEETING)", example = "PARTY") @RequestParam String sceneType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getSceneBasedRankings(sceneType, limit));
    }

    @ApiOperation("获取健康饮食排行")
    @GetMapping("/healthy")
    public ApiResponse<List<Rankings>> getHealthyFoodRankings(
            @ApiParam(value = "健康类型(LOW_CALORIE/LOW_FAT/LOW_SUGAR/HIGH_PROTEIN)", example = "LOW_CALORIE") @RequestParam String healthType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getHealthyFoodRankings(healthType, limit));
    }

    @ApiOperation("获取特殊饮食需求排行")
    @GetMapping("/dietary")
    public ApiResponse<List<Rankings>> getDietaryRankings(
            @ApiParam(value = "饮食类型(VEGETARIAN/VEGAN/GLUTEN_FREE/HALAL)", example = "VEGETARIAN") @RequestParam String dietaryType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getDietaryRankings(dietaryType, limit));
    }

    @ApiOperation("获取节日特色排行")
    @GetMapping("/festival")
    public ApiResponse<List<Rankings>> getFestivalRankings(
            @ApiParam(value = "节日类型", example = "SPRING_FESTIVAL") @RequestParam String festivalType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getFestivalRankings(festivalType, limit));
    }

    @ApiOperation("获取口味偏好排行")
    @GetMapping("/taste")
    public ApiResponse<List<Rankings>> getTastePreferenceRankings(
            @ApiParam(value = "口味类型(SPICY/SWEET/SOUR/BITTER/SALTY)", example = "SPICY") @RequestParam String tasteType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getTastePreferenceRankings(tasteType, limit));
    }

    @ApiOperation("获取烹饪方式排行")
    @GetMapping("/cooking-method")
    public ApiResponse<List<Rankings>> getCookingMethodRankings(
            @ApiParam(value = "烹饪方式(FRIED/STEAMED/BOILED/BAKED)", example = "FRIED") @RequestParam String cookingMethod,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getCookingMethodRankings(cookingMethod, limit));
    }

    @ApiOperation("获取食材排行")
    @GetMapping("/ingredient")
    public ApiResponse<List<Rankings>> getIngredientRankings(
            @ApiParam(value = "食材类型", example = "SEAFOOD") @RequestParam String ingredientType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getIngredientRankings(ingredientType, limit));
    }

    @ApiOperation("获取年龄段偏好排行")
    @GetMapping("/age-group")
    public ApiResponse<List<Rankings>> getAgeGroupRankings(
            @ApiParam(value = "年龄段(CHILDREN/YOUTH/ADULT/ELDERLY)", example = "YOUTH") @RequestParam String ageGroup,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getAgeGroupRankings(ageGroup, limit));
    }

    @ApiOperation("获取餐厅类型排行")
    @GetMapping("/restaurant-type")
    public ApiResponse<List<Rankings>> getRestaurantTypeRankings(
            @ApiParam(value = "餐厅类型(FAST_FOOD/FINE_DINING/CASUAL/BUFFET)", example = "FINE_DINING") @RequestParam String restaurantType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getRestaurantTypeRankings(restaurantType, limit));
    }

    @ApiOperation("获取外卖排行")
    @GetMapping("/takeaway")
    public ApiResponse<List<Rankings>> getTakeawayRankings(
            @ApiParam(value = "排序类型(SALES/RATING/DELIVERY_TIME)", example = "SALES") @RequestParam String sortType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getTakeawayRankings(sortType, limit));
    }

    @ApiOperation("获取性价比排行")
    @GetMapping("/value-for-money")
    public ApiResponse<List<Rankings>> getValueForMoneyRankings(
            @ApiParam(value = "价格区间", example = "MEDIUM") @RequestParam String priceRange,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getValueForMoneyRankings(priceRange, limit));
    }

    @ApiOperation("获取创新菜品排行")
    @GetMapping("/innovative")
    public ApiResponse<List<Rankings>> getInnovativeDishRankings(
            @ApiParam(value = "创新类型(FUSION/MOLECULAR/MODERN)", example = "FUSION") @RequestParam String innovationType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getInnovativeDishRankings(innovationType, limit));
    }

    @ApiOperation("获取节气美食排行")
    @GetMapping("/solar-term")
    public ApiResponse<List<Rankings>> getSolarTermRankings(
            @ApiParam(value = "节气名称", example = "SPRING_BEGINS") @RequestParam String solarTerm,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getSolarTermRankings(solarTerm, limit));
    }

    @ApiOperation("获取进店必点排行")
    @GetMapping("/must-order")
    public ApiResponse<List<Rankings>> getMustOrderRankings(
            @ApiParam(value = "餐厅ID", example = "1") @RequestParam Long restaurantId,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getMustOrderRankings(restaurantId, limit));
    }

    @ApiOperation("获取拍照打卡排行")
    @GetMapping("/photo-check-in")
    public ApiResponse<List<Rankings>> getPhotoCheckInRankings(
            @ApiParam(value = "时间范围(天)", example = "7") @RequestParam(defaultValue = "7") Integer days,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getPhotoCheckInRankings(days, limit));
    }

    @ApiOperation("获取深夜食堂排行")
    @GetMapping("/late-night")
    public ApiResponse<List<Rankings>> getLateNightRankings(
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getLateNightRankings(limit));
    }

    @ApiOperation("获取早餐排行")
    @GetMapping("/breakfast")
    public ApiResponse<List<Rankings>> getBreakfastRankings(
            @ApiParam(value = "排序类型(POPULAR/HEALTHY/QUICK)", example = "POPULAR") @RequestParam String sortType,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getBreakfastRankings(sortType, limit));
    }

    @ApiOperation("获取下午茶排行")
    @GetMapping("/afternoon-tea")
    public ApiResponse<List<Rankings>> getAfternoonTeaRankings(
            @ApiParam(value = "类型(DESSERT/DRINK/SET)", example = "DESSERT") @RequestParam String type,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getAfternoonTeaRankings(type, limit));
    }

    @ApiOperation("获取聚会推荐排行")
    @GetMapping("/gathering")
    public ApiResponse<List<Rankings>> getGatheringRankings(
            @ApiParam(value = "聚会类型(FAMILY/FRIENDS/BUSINESS)", example = "FAMILY") @RequestParam String gatheringType,
            @ApiParam(value = "人数", example = "6") @RequestParam Integer peopleCount,
            @ApiParam(value = "返回数量限制", example = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getGatheringRankings(gatheringType, peopleCount, limit));
    }
} 