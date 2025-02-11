package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.RankingsDTO;
import com.foodrecord.model.entity.Rankings;
import com.foodrecord.service.RankingsService;
import com.foodrecord.service.impl.RankingsServiceImpl;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.validation.Valid;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/rankings")
@Api(tags = "排行榜模块")
public class RankingsController {

    @Resource
    private RankingsService rankingsService;


    /**
     * 获取指定类型的排行榜
     *
     * @param rankType 排名类型（例如：POPULAR）
     * @param limit    返回数量限制（默认10）
     * @return 包含指定类型排行榜的ApiResponse对象
     */
    @ApiOperation(value = "获取指定类型的排行榜")
    @GetMapping("/{rankType}")
    public ApiResponse<List<Rankings>> getByRankType(
            @ApiParam(value = "排名类型", example = "POPULAR") @PathVariable String rankType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getByRankType(rankType, limit));
    }

    /**
     * 获取食物在特定类型排行榜中的排名
     *
     * @param foodId   食物ID（例如：1）
     * @param rankType 排名类型（例如：POPULAR）
     * @return 包含食物排名信息的ApiResponse对象
     */
    @ApiOperation(value = "获取食物在特定类型排行榜中的排名")
    @GetMapping("/food/{foodId}/{rankType}")
    public ApiResponse<Rankings> getByFoodIdAndType(
            @ApiParam(value = "食物ID", example = "1") @PathVariable Long foodId,
            @ApiParam(value = "排名类型", example = "POPULAR") @PathVariable String rankType) {
        return ApiResponse.success(rankingsService.getByFoodIdAndType(foodId, rankType));
    }

    /**
     * 创建或更新排名记录
     *
     * @param dto 排名记录DTO对象
     * @return 包含创建或更新结果的ApiResponse对象
     */
    @ApiOperation(value = "创建或更新排名记录")
    @PostMapping
    public ApiResponse<Rankings> createOrUpdate(@Valid @RequestBody RankingsDTO dto) {
        return ApiResponse.success(rankingsService.createOrUpdate(dto));
    }

    /**
     * 更新排名分数
     *
     * @param rankType 排名类型（例如：POPULAR）
     * @param foodId   食物ID（例如：1）
     * @param score    新的分数（例如：4.8）
     * @return 包含更新结果的ApiResponse对象
     */
    @ApiOperation(value = "更新排名分数")
    @PutMapping("/{rankType}/{foodId}/score")
    public ApiResponse<Boolean> updateScore(
            @ApiParam(value = "排名类型", example = "POPULAR") @PathVariable String rankType,
            @ApiParam(value = "食物ID", example = "1") @PathVariable Long foodId,
            @ApiParam(value = "新的分数", example = "4.8") @RequestParam Double score) {
        rankingsService.updateScore(rankType, foodId, score);
        return ApiResponse.success(true);
    }

    /**
     * 获取多个类型的排行榜
     *
     * @param rankTypes 排名类型列表（例如：POPULAR,RATING）
     * @param limit     返回数量限制（默认10）
     * @return 包含多个类型排行榜的ApiResponse对象
     */
    @ApiOperation(value = "获取多个类型的排行榜")
    @GetMapping("/multi-type")
    public ApiResponse<Map<String, List<Rankings>>> getMultiTypeRankings(
            @ApiParam(value = "排名类型列表", example = "POPULAR,RATING") @RequestParam List<String> rankTypes,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getMultiTypeRankings(rankTypes, limit));
    }

    /**
     * 获取排行榜变化趋势
     *
     * @param rankType  排名类型（例如：POPULAR）
     * @param startTime 开始时间
     * @param endTime   结束时间
     * @return 包含排行榜变化趋势的ApiResponse对象
     */
    @ApiOperation(value = "获取排行榜变化趋势")
    @GetMapping("/{rankType}/trends")
    public ApiResponse<List<Map<String, Object>>> getRankingTrends(
            @ApiParam(value = "排名类型", example = "POPULAR") @PathVariable String rankType,
            @ApiParam(value = "开始时间") @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime startTime,
            @ApiParam(value = "结束时间") @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime endTime) {
        return ApiResponse.success(rankingsService.getRankingTrends(rankType, startTime, endTime));
    }

    /**
     * 获取食物的历史排名记录
     *
     * @param foodId   食物ID（例如：1）
     * @param rankType 排名类型（例如：POPULAR），可选
     * @param startTime 开始时间
     * @param endTime   结束时间
     * @return 包含食物历史排名记录的ApiResponse对象
     */
    @ApiOperation(value = "获取食物的历史排名记录")
    @GetMapping("/food/{foodId}/history")
    public ApiResponse<List<Map<String, Object>>> getFoodRankingHistory(
            @ApiParam(value = "食物ID", example = "1") @PathVariable Long foodId,
            @ApiParam(value = "排名类型", example = "POPULAR", required = false) @RequestParam(required = false) String rankType,
            @ApiParam(value = "开始时间") @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime startTime,
            @ApiParam(value = "结束时间") @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime endTime) {
        return ApiResponse.success(rankingsService.getFoodRankingHistory(foodId, rankType, startTime, endTime));
    }

    /**
     * 获取排行榜前后变化
     *
     * @param rankType 排名类型（例如：POPULAR）
     * @param days     对比天数（默认7）
     * @param limit    返回数量限制（默认10）
     * @return 包含排行榜前后变化的ApiResponse对象
     */
    @ApiOperation(value = "获取排行榜前后变化")
    @GetMapping("/{rankType}/changes")
    public ApiResponse<List<Map<String, Object>>> getRankingChanges(
            @ApiParam(value = "排名类型", example = "POPULAR") @PathVariable String rankType,
            @ApiParam(value = "对比天数", example = "7", defaultValue = "7") @RequestParam(defaultValue = "7") Integer days,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getRankingChanges(rankType, days, limit));
    }

    /**
     * 获取类别排行榜
     *
     * @param categoryId 类别ID（例如：1）
     * @param rankType   排名类型（例如：POPULAR）
     * @param limit      返回数量限制（默认10）
     * @return 包含类别排行榜的ApiResponse对象
     */
    @ApiOperation(value = "获取类别排行榜")
    @GetMapping("/category/{categoryId}")
    public ApiResponse<List<Rankings>> getCategoryRankings(
            @ApiParam(value = "类别ID", example = "1") @PathVariable Long categoryId,
            @ApiParam(value = "排名类型", example = "POPULAR") @RequestParam String rankType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getCategoryRankings(categoryId, rankType, limit));
    }

    /**
     * 获取排行榜统计信息
     *
     * @param rankType 排名类型（例如：POPULAR）
     * @return 包含排行榜统计信息的ApiResponse对象
     */
    @ApiOperation(value = "获取排行榜统计信息")
    @GetMapping("/{rankType}/stats")
    public ApiResponse<Map<String, Object>> getRankingStats(
            @ApiParam(value = "排名类型", example = "POPULAR") @PathVariable String rankType) {
        return ApiResponse.success(rankingsService.getRankingStats(rankType));
    }

    /**
     * 获取综合排名
     *
     * @param limit 返回数量限制（默认10）
     * @return 包含综合排名的ApiResponse对象
     */
    @ApiOperation(value = "获取综合排名")
    @GetMapping("/comprehensive")
    public ApiResponse<List<Map<String, Object>>> getComprehensiveRankings(
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getComprehensiveRankings(limit));
    }

    /**
     * 获取时段热门排行
     *
     * @param rankType   排名类型（例如：POPULAR）
     * @param periodType 时段类型（例如：MORNING/NOON/EVENING）
     * @param limit      返回数量限制（默认10）
     * @return 包含时段热门排行的ApiResponse对象
     */
    @ApiOperation(value = "获取时段热门排行")
    @GetMapping("/time-period")
    public ApiResponse<List<Rankings>> getTimePeriodRankings(
            @ApiParam(value = "排名类型", example = "POPULAR") @RequestParam String rankType,
            @ApiParam(value = "时段类型(MORNING/NOON/EVENING)", example = "MORNING") @RequestParam String periodType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getTimePeriodRankings(rankType, periodType, limit));
    }

    /**
     * 获取区域排行榜
     *
     * @param regionCode 区域代码（例如：330100）
     * @param rankType   排名类型（例如：POPULAR）
     * @param limit      返回数量限制（默认10）
     * @return 包含区域排行榜的ApiResponse对象
     */
    @ApiOperation(value = "获取区域排行榜")
    @GetMapping("/region/{regionCode}")
    public ApiResponse<List<Rankings>> getRegionRankings(
            @ApiParam(value = "区域代码", example = "330100") @PathVariable String regionCode,
            @ApiParam(value = "排名类型", example = "POPULAR") @RequestParam String rankType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getRegionRankings(regionCode, rankType, limit));
    }

    /**
     * 获取季节性排行榜
     *
     * @param rankType 排名类型（例如：POPULAR）
     * @param season   季节（例如：SPRING/SUMMER/AUTUMN/WINTER）
     * @param limit    返回数量限制（默认10）
     * @return 包含季节性排行榜的ApiResponse对象
     */
    @ApiOperation(value = "获取季节性排行榜")
    @GetMapping("/seasonal")
    public ApiResponse<List<Rankings>> getSeasonalRankings(
            @ApiParam(value = "排名类型", example = "POPULAR") @RequestParam String rankType,
            @ApiParam(value = "季节(SPRING/SUMMER/AUTUMN/WINTER)", example = "SUMMER") @RequestParam String season,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getSeasonalRankings(rankType, season, limit));
    }

    /**
     * 获取用户偏好排行
     *
     * @param userId 用户ID（例如：1）
     * @param limit  返回数量限制（默认10）
     * @return 包含用户偏好排行的ApiResponse对象
     */
    @ApiOperation(value = "获取用户偏好排行")
    @GetMapping("/user-preference/{userId}")
    public ApiResponse<List<Rankings>> getUserPreferenceRankings(
            @ApiParam(value = "用户ID", example = "1") @PathVariable Long userId,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getUserPreferenceRankings(userId, limit));
    }

    /**
     * 获取营养价值排行
     *
     * @param nutritionType 营养类型（例如：PROTEIN/VITAMIN/FIBER等）
     * @param limit         返回数量限制（默认10）
     * @return 包含营养价值排行的ApiResponse对象
     */
    @ApiOperation(value = "获取营养价值排行")
    @GetMapping("/nutrition")
    public ApiResponse<List<Rankings>> getNutritionRankings(
            @ApiParam(value = "营养类型(PROTEIN/VITAMIN/FIBER等)", example = "PROTEIN") @RequestParam String nutritionType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getNutritionRankings(nutritionType, limit));
    }

    /**
     * 获取价格区间排行
     *
     * @param minPrice  最小价格（例如：0）
     * @param maxPrice  最大价格（例如：100）
     * @param rankType  排名类型（例如：POPULAR）
     * @param limit     返回数量限制（默认10）
     * @return 包含价格区间排行的ApiResponse对象
     */
    @ApiOperation(value = "获取价格区间排行")
    @GetMapping("/price-range")
    public ApiResponse<List<Rankings>> getPriceRangeRankings(
            @ApiParam(value = "最小价格", example = "0") @RequestParam Double minPrice,
            @ApiParam(value = "最大价格", example = "100") @RequestParam Double maxPrice,
            @ApiParam(value = "排名类型", example = "POPULAR") @RequestParam String rankType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getPriceRangeRankings(minPrice, maxPrice, rankType, limit));
    }

    /**
     * 获取评分区间排行
     *
     * @param minRating 最小评分（例如：4.0）
     * @param maxRating 最大评分（例如：5.0）
     * @param limit     返回数量限制（默认10）
     * @return 包含评分区间排行的ApiResponse对象
     */
    @ApiOperation(value = "获取评分区间排行")
    @GetMapping("/rating-range")
    public ApiResponse<List<Rankings>> getRatingRangeRankings(
            @ApiParam(value = "最小评分", example = "4.0") @RequestParam Double minRating,
            @ApiParam(value = "最大评分", example = "5.0") @RequestParam Double maxRating,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getRatingRangeRankings(minRating, maxRating, limit));
    }

    /**
     * 获取新品排行
     *
     * @param days     天数范围（默认30）
     * @param rankType 排名类型（例如：POPULAR）
     * @param limit    返回数量限制（默认10）
     * @return 包含新品排行的ApiResponse对象
     */
    @ApiOperation(value = "获取新品排行")
    @GetMapping("/new-items")
    public ApiResponse<List<Rankings>> getNewItemRankings(
            @ApiParam(value = "天数范围", example = "30", defaultValue = "30") @RequestParam(defaultValue = "30") Integer days,
            @ApiParam(value = "排名类型", example = "POPULAR") @RequestParam String rankType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getNewItemRankings(days, rankType, limit));
    }

    /**
     * 获取标签排行
     *
     * @param tagName  标签名称（例如：素食）
     * @param rankType 排名类型（例如：POPULAR）
     * @param limit    返回数量限制（默认10）
     * @return 包含标签排行的ApiResponse对象
     */
    @ApiOperation(value = "获取标签排行")
    @GetMapping("/tag/{tagName}")
    public ApiResponse<List<Rankings>> getTagRankings(
            @ApiParam(value = "标签名称", example = "素食") @PathVariable String tagName,
            @ApiParam(value = "排名类型", example = "POPULAR") @RequestParam String rankType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getTagRankings(tagName, rankType, limit));
    }

    /**
     * 获取热度上升最快排行
     *
     * @param hours 时间范围(小时)（默认24）
     * @param limit 返回数量限制（默认10）
     * @return 包含热度上升最快排行的ApiResponse对象
     */
    @ApiOperation(value = "获取热度上升最快排行")
    @GetMapping("/trending")
    public ApiResponse<List<Rankings>> getTrendingRankings(
            @ApiParam(value = "时间范围(小时)", example = "24", defaultValue = "24") @RequestParam(defaultValue = "24") Integer hours,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getTrendingRankings(hours, limit));
    }

    /**
     * 获取特定场景下的推荐排行
     *
     * @param sceneType 场景类型（例如：PARTY）
     * @param limit     返回数量限制（默认10）
     * @return 包含特定场景下的推荐排行的ApiResponse对象
     */
    @ApiOperation(value = "获取特定场景下的推荐排行")
    @GetMapping("/scene")
    public ApiResponse<List<Rankings>> getSceneBasedRankings(
            @ApiParam(value = "场景类型(BREAKFAST/LUNCH/DINNER/PARTY/MEETING)", example = "PARTY") @RequestParam String sceneType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getSceneBasedRankings(sceneType, limit));
    }

    /**
     * 获取健康饮食排行
     *
     * @param healthType 健康类型（例如：LOW_CALORIE）
     * @param limit      返回数量限制（默认10）
     * @return 包含健康饮食排行的ApiResponse对象
     */
    @ApiOperation(value = "获取健康饮食排行")
    @GetMapping("/healthy")
    public ApiResponse<List<Rankings>> getHealthyFoodRankings(
            @ApiParam(value = "健康类型(LOW_CALORIE/LOW_FAT/LOW_SUGAR/HIGH_PROTEIN)", example = "LOW_CALORIE") @RequestParam String healthType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getHealthyFoodRankings(healthType, limit));
    }

    /**
     * 获取特殊饮食需求排行
     *
     * @param dietaryType 饮食类型（例如：VEGETARIAN）
     * @param limit       返回数量限制（默认10）
     * @return 包含特殊饮食需求排行的ApiResponse对象
     */
    @ApiOperation(value = "获取特殊饮食需求排行")
    @GetMapping("/dietary")
    public ApiResponse<List<Rankings>> getDietaryRankings(
            @ApiParam(value = "饮食类型(VEGETARIAN/VEGAN/GLUTEN_FREE/HALAL)", example = "VEGETARIAN") @RequestParam String dietaryType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getDietaryRankings(dietaryType, limit));
    }

    /**
     * 获取节日特色排行
     *
     * @param festivalType 节日类型（例如：SPRING_FESTIVAL）
     * @param limit        返回数量限制（默认10）
     * @return 包含节日特色排行的ApiResponse对象
     */
    @ApiOperation(value = "获取节日特色排行")
    @GetMapping("/festival")
    public ApiResponse<List<Rankings>> getFestivalRankings(
            @ApiParam(value = "节日类型", example = "SPRING_FESTIVAL") @RequestParam String festivalType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getFestivalRankings(festivalType, limit));
    }

    /**
     * 获取口味偏好排行
     *
     * @param tasteType 口味类型（例如：SPICY）
     * @param limit     返回数量限制（默认10）
     * @return 包含口味偏好排行的ApiResponse对象
     */
    @ApiOperation(value = "获取口味偏好排行")
    @GetMapping("/taste")
    public ApiResponse<List<Rankings>> getTastePreferenceRankings(
            @ApiParam(value = "口味类型(SPICY/SWEET/SOUR/BITTER/SALTY)", example = "SPICY") @RequestParam String tasteType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getTastePreferenceRankings(tasteType, limit));
    }

    /**
     * 获取烹饪方式排行
     *
     * @param cookingMethod 烹饪方式（例如：FRIED）
     * @param limit         返回数量限制（默认10）
     * @return 包含烹饪方式排行的ApiResponse对象
     */
    @ApiOperation(value = "获取烹饪方式排行")
    @GetMapping("/cooking-method")
    public ApiResponse<List<Rankings>> getCookingMethodRankings(
            @ApiParam(value = "烹饪方式(FRIED/STEAMED/BOILED/BAKED)", example = "FRIED") @RequestParam String cookingMethod,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getCookingMethodRankings(cookingMethod, limit));
    }

    /**
     * 获取食材排行
     *
     * @param ingredientType 食材类型（例如：SEAFOOD）
     * @param limit          返回数量限制（默认10）
     * @return 包含食材排行的ApiResponse对象
     */
    @ApiOperation(value = "获取食材排行")
    @GetMapping("/ingredient")
    public ApiResponse<List<Rankings>> getIngredientRankings(
            @ApiParam(value = "食材类型", example = "SEAFOOD") @RequestParam String ingredientType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getIngredientRankings(ingredientType, limit));
    }

    /**
     * 获取年龄段偏好排行
     *
     * @param ageGroup 年龄段（例如：YOUTH）
     * @param limit    返回数量限制（默认10）
     * @return 包含年龄段偏好排行的ApiResponse对象
     */
    @ApiOperation(value = "获取年龄段偏好排行")
    @GetMapping("/age-group")
    public ApiResponse<List<Rankings>> getAgeGroupRankings(
            @ApiParam(value = "年龄段(CHILDREN/YOUTH/ADULT/ELDERLY)", example = "YOUTH") @RequestParam String ageGroup,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getAgeGroupRankings(ageGroup, limit));
    }

    /**
     * 获取餐厅类型排行
     *
     * @param restaurantType 餐厅类型（例如：FINE_DINING）
     * @param limit          返回数量限制（默认10）
     * @return 包含餐厅类型排行的ApiResponse对象
     */
    @ApiOperation(value = "获取餐厅类型排行")
    @GetMapping("/restaurant-type")
    public ApiResponse<List<Rankings>> getRestaurantTypeRankings(
            @ApiParam(value = "餐厅类型(FAST_FOOD/FINE_DINING/CASUAL/BUFFET)", example = "FINE_DINING") @RequestParam String restaurantType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getRestaurantTypeRankings(restaurantType, limit));
    }

    /**
     * 获取外卖排行
     *
     * @param sortType 排序类型（例如：SALES）
     * @param limit    返回数量限制（默认10）
     * @return 包含外卖排行的ApiResponse对象
     */
    @ApiOperation(value = "获取外卖排行")
    @GetMapping("/takeaway")
    public ApiResponse<List<Rankings>> getTakeawayRankings(
            @ApiParam(value = "排序类型(SALES/RATING/DELIVERY_TIME)", example = "SALES") @RequestParam String sortType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getTakeawayRankings(sortType, limit));
    }

    /**
     * 获取性价比排行
     *
     * @param priceRange 价格区间（例如：MEDIUM）
     * @param limit      返回数量限制（默认10）
     * @return 包含性价比排行的ApiResponse对象
     */
    @ApiOperation(value = "获取性价比排行")
    @GetMapping("/value-for-money")
    public ApiResponse<List<Rankings>> getValueForMoneyRankings(
            @ApiParam(value = "价格区间", example = "MEDIUM") @RequestParam String priceRange,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getValueForMoneyRankings(priceRange, limit));
    }

    /**
     * 获取创新菜品排行
     *
     * @param innovationType 创新类型（例如：FUSION）
     * @param limit          返回数量限制（默认10）
     * @return 包含创新菜品排行的ApiResponse对象
     */
    @ApiOperation(value = "获取创新菜品排行")
    @GetMapping("/innovative")
    public ApiResponse<List<Rankings>> getInnovativeDishRankings(
            @ApiParam(value = "创新类型(FUSION/MOLECULAR/MODERN)", example = "FUSION") @RequestParam String innovationType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getInnovativeDishRankings(innovationType, limit));
    }

    /**
     * 获取节气美食排行
     *
     * @param solarTerm 节气名称（例如：SPRING_BEGINS）
     * @param limit     返回数量限制（默认10）
     * @return 包含节气美食排行的ApiResponse对象
     */
    @ApiOperation(value = "获取节气美食排行")
    @GetMapping("/solar-term")
    public ApiResponse<List<Rankings>> getSolarTermRankings(
            @ApiParam(value = "节气名称", example = "SPRING_BEGINS") @RequestParam String solarTerm,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getSolarTermRankings(solarTerm, limit));
    }

    /**
     * 获取进店必点排行
     *
     * @param restaurantId 餐厅ID（例如：1）
     * @param limit        返回数量限制（默认10）
     * @return 包含进店必点排行的ApiResponse对象
     */
    @ApiOperation(value = "获取进店必点排行")
    @GetMapping("/must-order")
    public ApiResponse<List<Rankings>> getMustOrderRankings(
            @ApiParam(value = "餐厅ID", example = "1") @RequestParam Long restaurantId,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getMustOrderRankings(restaurantId, limit));
    }

    /**
     * 获取拍照打卡排行
     *
     * @param days  时间范围(天)（默认7）
     * @param limit 返回数量限制（默认10）
     * @return 包含拍照打卡排行的ApiResponse对象
     */
    @ApiOperation(value = "获取拍照打卡排行")
    @GetMapping("/photo-check-in")
    public ApiResponse<List<Rankings>> getPhotoCheckInRankings(
            @ApiParam(value = "时间范围(天)", example = "7", defaultValue = "7") @RequestParam(defaultValue = "7") Integer days,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getPhotoCheckInRankings(days, limit));
    }

    /**
     * 获取深夜食堂排行
     *
     * @param limit 返回数量限制（默认10）
     * @return 包含深夜食堂排行的ApiResponse对象
     */
    @ApiOperation(value = "获取深夜食堂排行")
    @GetMapping("/late-night")
    public ApiResponse<List<Rankings>> getLateNightRankings(
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getLateNightRankings(limit));
    }

    /**
     * 获取早餐排行
     *
     * @param sortType 排序类型（例如：POPULAR）
     * @param limit    返回数量限制（默认10）
     * @return 包含早餐排行的ApiResponse对象
     */
    @ApiOperation(value = "获取早餐排行")
    @GetMapping("/breakfast")
    public ApiResponse<List<Rankings>> getBreakfastRankings(
            @ApiParam(value = "排序类型(POPULAR/HEALTHY/QUICK)", example = "POPULAR") @RequestParam String sortType,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getBreakfastRankings(sortType, limit));
    }

    /**
     * 获取下午茶排行
     *
     * @param type  类型（例如：DESSERT）
     * @param limit 返回数量限制（默认10）
     * @return 包含下午茶排行的ApiResponse对象
     */
    @ApiOperation(value = "获取下午茶排行")
    @GetMapping("/afternoon-tea")
    public ApiResponse<List<Rankings>> getAfternoonTeaRankings(
            @ApiParam(value = "类型(DESSERT/DRINK/SET)", example = "DESSERT") @RequestParam String type,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getAfternoonTeaRankings(type, limit));
    }

    /**
     * 获取聚会推荐排行
     *
     * @param gatheringType 聚会类型（例如：FAMILY）
     * @param peopleCount   人数（例如：6）
     * @param limit         返回数量限制（默认10）
     * @return 包含聚会推荐排行的ApiResponse对象
     */
    @ApiOperation(value = "获取聚会推荐排行")
    @GetMapping("/gathering")
    public ApiResponse<List<Rankings>> getGatheringRankings(
            @ApiParam(value = "聚会类型(FAMILY/FRIENDS/BUSINESS)", example = "FAMILY") @RequestParam String gatheringType,
            @ApiParam(value = "人数", example = "6") @RequestParam Integer peopleCount,
            @ApiParam(value = "返回数量限制", example = "10", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getGatheringRankings(gatheringType, peopleCount, limit));
    }
} 