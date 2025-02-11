package com.foodrecord.controller.user;

import cn.hutool.core.io.resource.ClassPathResource;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.AuthContext;
import com.foodrecord.common.auth.RequireRole;
import com.foodrecord.exception.CustomException;
//import com.foodrecord.ml.feature.FeatureExtractor;
import com.foodrecord.model.dto.FoodDTO;
import com.foodrecord.model.entity.Food;
import com.foodrecord.model.entity.User;
import com.foodrecord.service.FoodSearchService;
import com.foodrecord.service.FoodService;
import com.foodrecord.service.RecommenderService;
import com.foodrecord.service.UserService;
import com.foodrecord.service.recommendation.CollaborativeFilteringRecommendationStrategy;
import com.foodrecord.service.recommendation.RecommendationContext;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Pageable;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.validation.Valid;
import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/foods")
@Api(tags = "用户食品模块")
public class FoodController {
    @Resource
    private FoodService foodService;

    @Resource
    private RecommenderService recommenderService;

    @Resource
    private UserService userService;

//    @Resource
//    private FeatureExtractor featureExtractor;

    @PostMapping("/admin/train")
    @ApiOperation("手动训练模型(管理员)")
    public ApiResponse<String> initializeAndTrainModel() {
        ClassPathResource classPathResource = new ClassPathResource("models/food_recommend_model.zip");
        File file = classPathResource.getFile();
        String absoluteFIlePath = file.getAbsolutePath();
        System.out.println("开始训练模型");
        recommenderService.trainModel();
        recommenderService.saveModel(absoluteFIlePath);
        // 加载模型
        recommenderService.loadModel(absoluteFIlePath);
        return ApiResponse.success("模型重新构建完成");
    }

    /**
     * 在重新启动系统时，可以加载之前保存的模型，而不需要重新训练：
     */
//    @PostConstruct
//    public void loadExistingModel() {
//        ClassPathResource classPathResource = new ClassPathResource("models/food_recommend_model.zip");
//        File file = classPathResource.getFile();
//        String absoluteFIlePath = file.getAbsolutePath();
//        System.out.println("开始训练模型");
////        recommenderService.trainModel();
////        recommenderService.saveModel(absoluteFIlePath);
//        // 加载模型
//        recommenderService.loadModel(absoluteFIlePath);
//        System.out.println("模型已加载！");
//    }

    @GetMapping("/recommend")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    @ApiOperation(value = "机器学习推荐食物功能", notes = "可以根据机器学习算法，进行用户的匹配食物推荐，输入需要推荐几条数据即可")
    public ApiResponse<List<Food>> recommendForUser(
            @ApiParam(value = "获取推荐数量", example = "5")
            @RequestParam int numRecommendations) {
        try {
            User currentUser = AuthContext.getCurrentUser();
            RecommendationContext recommendationContext = new RecommendationContext();
            List<Long> recommendedFoodIds = List.of();
            // 根据用户身份设置推荐策略
            switch (currentUser.getRole()) {
                case "USER":
                case "ADMIN":
                    recommendationContext.setRecommendationStrategy(new CollaborativeFilteringRecommendationStrategy(recommenderService));
                    recommendedFoodIds = recommendationContext.recommend(currentUser.getId(), numRecommendations);
                    break;
                case "VIP":
                case "SUPERADMIN":
                    recommendedFoodIds = recommenderService.recommendForUser(currentUser.getId(), numRecommendations);
                    break;
                default:
                    throw new CustomException("无权使用该算法");
            }
            List<Food> foodArrayList = new ArrayList<>();
            for (Long foodId : recommendedFoodIds) {
                foodArrayList.add(foodService.findById(foodId));
            }
            return ApiResponse.success(foodArrayList);
        }catch(Exception e){
            e.printStackTrace();
        }
        return ApiResponse.error(500, "服务器错误");
    }

    @GetMapping("/predict")
    @ApiOperation("机器学习预测测试(无需对接)")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<Map<String, Double>> predictRating(
            @ApiParam(value = "", example = "")
            @RequestParam Long userId, @RequestParam Long foodId) {
        Map<String, Double> map = new HashMap<>();
        map.put("degree", recommenderService.predictRating(userId, foodId));
        return ApiResponse.success(map);
    }


    @GetMapping
    @ApiOperation("获取食物")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<Page<Food>> getAllFoods(Pageable pageable) {
        return ApiResponse.success(foodService.getAllFoods(pageable));
    }

    @GetMapping("/{id}")
    @ApiOperation("根据id获取食物")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<Food> getFoodById(@PathVariable Long id) {
        return ApiResponse.success(foodService.getFoodById(id));
    }

    @GetMapping("/search")
    @ApiOperation("根据菜名获取食品")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<List<Food>> searchFoods(@RequestParam String name) {
        return ApiResponse.success(foodService.searchFoodsByName(name));
    }

    @PostMapping
    @ApiOperation("创建食品")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<Food> createFood(@Valid @RequestBody FoodDTO foodDTO) {
        return ApiResponse.success(foodService.createFood(foodDTO));
    }

    @PutMapping("/{id}")
    @ApiOperation("更新食品")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<Food> updateFood(@PathVariable Long id, @Valid @RequestBody FoodDTO foodDTO) {
        return ApiResponse.success(foodService.updateFood(id, foodDTO));
    }

    @DeleteMapping("/{id}")
    @ApiOperation("根据id删除食品")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<Void> deleteFood(@PathVariable Long id) {
        foodService.deleteFood(id);
        return ApiResponse.success(null);
    }

    @Autowired
    private FoodSearchService foodSearchService;

    @GetMapping("/es/search")
    public Page<Food> search(
            @RequestParam String keyword,
            @RequestParam(defaultValue = "1") long current, // 当前页码，默认第 1 页
            @RequestParam(defaultValue = "10") long size   // 每页条数，默认 10 条
    ) {
        return foodSearchService.search(keyword, new Page<>(current, size));
    }

    @GetMapping("/es/aggregate/healthLight")
    public Map<String, Long> aggregateByHealthLight() {
        return foodSearchService.aggregateByHealthLight();
    }

    @GetMapping("/es/suggest")
    public List<String> suggest(
            @RequestParam String prefix
    ) {
        return foodSearchService.suggest(prefix);
    }

    @GetMapping("/categories")
    @ApiOperation("按分类获取食品")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<Page<Food>> getFoodsByCategory(
            @RequestParam String category,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(foodService.getFoodsByCategory(category, pageNum, pageSize));
    }

    @GetMapping("/nutrition/score/{id}")
    @ApiOperation("获取食品营养评分")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<Map<String, Object>> getNutritionScore(@PathVariable Long id) {
        return ApiResponse.success(foodService.calculateNutritionScore(id));
    }

    @GetMapping("/nutrition/compare")
    @ApiOperation("比较多个食品的营养成分")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<List<Map<String, Object>>> compareNutrition(
            @RequestParam List<Long> foodIds) {
        return ApiResponse.success(foodService.compareNutritionInfo(foodIds));
    }

    @GetMapping("/popular")
    @ApiOperation("获取热门食品")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<List<Food>> getPopularFoods(
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(foodService.getPopularFoods(limit));
    }

    @GetMapping("/stats/category")
    @ApiOperation("获取食品分类统计")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<Map<String, Long>> getCategoryStats() {
        return ApiResponse.success(foodService.getCategoryStats());
    }

    @GetMapping("/health-analysis")
    @ApiOperation("健康分析")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> getHealthAnalysis(@RequestParam Long foodId) {
        // 基于已有的healthLight和healthLabel字段进行分析
        // 返回食品的健康指数和建议
        return ApiResponse.success(foodService.analyzeHealthIndex(foodId));
    }

    @GetMapping("/filter")
    @ApiOperation("多条件筛选食品")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Food>> filterFoods(
            @RequestParam(required = false) String healthLight,
            @RequestParam(required = false) String healthLabel,
            @RequestParam(required = false) Boolean isDynamicDish,
            @RequestParam(required = false) Boolean isLiquid) {
        // 使用现有字段进行多条件筛选
        return ApiResponse.success(foodService.filterFoods(healthLight, healthLabel, isDynamicDish, isLiquid));
    }

    @GetMapping("/suggest/daily")
    @ApiOperation("每日食品建议")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Food>> getDailySuggestions() {
        // 基于suggest字段提供建议
        return ApiResponse.success(foodService.getDailySuggestions());
    }


    @GetMapping("/foods/recommend/similar")
    @ApiOperation("获取相似食品推荐")
    @RequireRole({"GUEST", "USER", "ADMIN"})
    public ApiResponse<List<Food>> getSimilarFoods(
            @RequestParam Long foodId,
            @RequestParam(defaultValue = "5") int limit) {
        // 基于当前食品的healthLight、healthLabel等属性推荐相似食品
        return ApiResponse.success(foodService.getSimilarFoods(foodId, limit));
    }

    @GetMapping("/foods/recommend/health")
    @ApiOperation("获取健康替代品推荐")
    @RequireRole({"GUEST", "USER", "ADMIN"})
    public ApiResponse<List<Food>> getHealthyAlternatives(
            @RequestParam Long foodId,
            @RequestParam(defaultValue = "5") int limit) {
        // 推荐healthLight更好的替代食品
        return ApiResponse.success(foodService.getHealthyAlternatives(foodId, limit));
    }

    @GetMapping("/foods/search/advanced")
    @ApiOperation("高级搜索")
    @RequireRole({"GUEST", "USER", "ADMIN"})
    public ApiResponse<Page<Food>> advancedSearch(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) List<String> healthLabels,
            @RequestParam(required = false) Integer minHealthLight,
            @RequestParam(required = false) Integer maxHealthLight,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(foodService.advancedSearch(keyword, healthLabels,
                minHealthLight, maxHealthLight, pageNum, pageSize));
    }

    @GetMapping("/foods/combo")
    @ApiOperation("获取食品搭配建议")
    @RequireRole({"GUEST", "USER", "ADMIN"})
    public ApiResponse<List<List<Food>>> getFoodCombos(
            @RequestParam Long foodId,
            @RequestParam(defaultValue = "5") int limit) {
        // 基于食品的healthLabel和suggest属性推荐搭配
        return ApiResponse.success(foodService.getFoodCombos(foodId, limit));
    }

    @GetMapping("/foods/seasonal")
    @ApiOperation("获取时令食品")
    @RequireRole({"GUEST", "USER", "ADMIN"})
    public ApiResponse<List<Food>> getSeasonalFoods(
            @RequestParam(required = false) String season,  // 春夏秋冬
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(foodService.getSeasonalFoods(season, limit));
    }

    @GetMapping("/foods/seasonal/current")
    @ApiOperation("获取当季食品")
    @RequireRole({"GUEST", "USER", "ADMIN"})
    public ApiResponse<List<Food>> getCurrentSeasonFoods(
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(foodService.getCurrentSeasonFoods(limit));
    }

    @GetMapping("/foods/balance")
    @ApiOperation("获取营养均衡搭配")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, List<Food>>> getBalancedMeal(
            @RequestParam(defaultValue = "2000") int targetCalories) {
        // 根据目标卡路里，返回一天的均衡搭配
        return ApiResponse.success(foodService.getBalancedMeal(targetCalories));
    }

    @GetMapping("/foods/{foodId}/substitutes")
    @ApiOperation("获取食品替代品")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Food>> getFoodSubstitutes(
            @PathVariable Long foodId,
            @RequestParam(required = false) String preferenceType, // 低卡/高蛋白/低脂等
            @RequestParam(defaultValue = "5") int limit) {
        return ApiResponse.success(foodService.getFoodSubstitutes(foodId, preferenceType, limit));
    }

    @GetMapping("/foods/tags")
    @ApiOperation("获取食品标签统计")
    @RequireRole({"GUEST", "USER", "ADMIN"})
    public ApiResponse<Map<String, Integer>> getFoodTags() {
        // 基于healthLabel字段统计各标签数量
        return ApiResponse.success(foodService.getFoodTagStats());
    }

    @GetMapping("/foods/tags/{tag}")
    @ApiOperation("根据标签获取食品")
    @RequireRole({"GUEST", "USER", "ADMIN"})
    public ApiResponse<List<Food>> getFoodsByTag(
            @PathVariable String tag,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return ApiResponse.success(foodService.getFoodsByTag(tag, pageNum, pageSize));
    }

    @GetMapping("/foods/nutrition/analysis")
    @ApiOperation("获取食品营养分析")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> getNutritionAnalysis(
            @RequestParam List<Long> foodIds) {
        // 分析多个食品的营养构成
        return ApiResponse.success(foodService.analyzeNutrition(foodIds));
    }

    @GetMapping("/foods/nutrition/recommendation")
    @ApiOperation("获取营养补充建议")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Food>> getNutritionRecommendation(
            @RequestParam Long foodId) {
        // 基于当前食品的营养成分，推荐互补的食品
        return ApiResponse.success(foodService.getNutritionComplementaryFoods(foodId));
    }

    @GetMapping("/foods/ranking/health")
    @ApiOperation("获取健康指数排行")
    @RequireRole({"GUEST", "USER", "ADMIN"})
    public ApiResponse<List<Food>> getHealthRanking(
            @RequestParam(defaultValue = "10") int limit) {
        // 基于healthLight排序
        return ApiResponse.success(foodService.getHealthRanking(limit));
    }

    @GetMapping("/foods/ranking/nutrition/{type}")
    @ApiOperation("获取营养成分排行")
    @RequireRole({"GUEST", "USER", "ADMIN"})
    public ApiResponse<List<Food>> getNutritionRanking(
            @PathVariable String type,  // protein/fat/carbs/vitamin
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(foodService.getNutritionRanking(type, limit));
    }

    @GetMapping("/foods/trends")
    @ApiOperation("获取食品趋势分析")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> getFoodTrends(
            @RequestParam(required = false) String timeRange,  // daily/weekly/monthly
            @RequestParam(defaultValue = "10") int limit) {
        // 分析食品的浏览量、收藏量等趋势
        return ApiResponse.success(foodService.analyzeFoodTrends(timeRange, limit));
    }

    @GetMapping("/foods/ranking/comprehensive")
    @ApiOperation("获取综合评分排行")
    @RequireRole({"GUEST", "USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getComprehensiveRanking(
            @RequestParam(defaultValue = "10") int limit) {
        // 基于多个维度（健康指数、营养评分、用户评分等）的综合排名
        return ApiResponse.success(foodService.getComprehensiveRanking(limit));
    }

    @GetMapping("/foods/{foodId}/suitable-crowd")
    @ApiOperation("获取食品适应人群分析")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> getSuitableCrowd(
            @PathVariable Long foodId) {
        // 基于食品的营养特点分析适合的人群
        return ApiResponse.success(foodService.analyzeSuitableCrowd(foodId));
    }

    @GetMapping("/foods/vitamins/analysis")
    @ApiOperation("获取食品维生素分析")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> getVitaminAnalysis(
            @RequestParam Long foodId) {
        // 结合Food和Vitamins表分析维生素含量和建议
        return ApiResponse.success(foodService.analyzeVitamins(foodId));
    }

    @GetMapping("/foods/vitamins/ranking/{type}")
    @ApiOperation("获取维生素含量排行")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getVitaminRanking(
            @PathVariable String type,  // A/B/C/D/E等维生素类型
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(foodService.getVitaminRanking(type, limit));
    }
    @GetMapping("/foods/comprehensive/analysis")
    @ApiOperation("获取综合营养分析")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> getComprehensiveAnalysis(
            @RequestParam Long foodId) {
        // 结合Food、Nutrition和Vitamins表进行全面分析
        return ApiResponse.success(foodService.getComprehensiveAnalysis(foodId));
    }
} 