package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.cache.CacheDegradeStrategy;
import com.foodrecord.common.exception.CustomException;
import com.foodrecord.common.lock.RedisDistributedLock;
import com.foodrecord.common.utils.RedisUtils;
import com.foodrecord.mapper.FoodMapper;
import com.foodrecord.mapper.NutritionMapper;
import com.foodrecord.mapper.VitaminsMapper;
import com.foodrecord.model.dto.FoodDTO;
import com.foodrecord.model.entity.Food;
import com.foodrecord.common.monitor.CacheMonitor;
import com.foodrecord.model.entity.Nutrition;
import com.foodrecord.model.entity.Vitamins;
import com.foodrecord.model.entity.user.UserHealthData;
import com.foodrecord.service.FoodService;
import com.foodrecord.service.UserHealthDataService;
import org.springframework.cache.annotation.CacheConfig;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.CachePut;
import org.springframework.cache.annotation.Cacheable;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import javax.annotation.Resource;
import java.util.*;
import java.util.concurrent.TimeUnit;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;

@Service
@CacheConfig(cacheNames = "food")
public class FoodServiceImpl extends ServiceImpl<FoodMapper, Food> implements FoodService {

    private final FoodMapper foodMapper;

    private final RedisUtils redisUtils;

    private final RedisDistributedLock distributedLock;

    private final CacheDegradeStrategy cacheStrategy;

    private final CacheMonitor cacheMonitor;

    private final NutritionMapper nutritionMapper;

    private RedisTemplate<String, Object> redisTemplate;

    private static final String FOOD_CACHE_KEY = "food:";

    private static final long FOOD_CACHE_TIME = 3600; // 1小时

    private final VitaminsMapper vitaminsMapper;

    private final UserHealthDataService userHealthDataService;

    public FoodServiceImpl(FoodMapper foodMapper, RedisUtils redisUtils, RedisDistributedLock distributedLock, CacheDegradeStrategy cacheStrategy, CacheMonitor cacheMonitor, NutritionMapper nutritionMapper, VitaminsMapper vitaminsMapper, UserHealthDataService userHealthDataService) {
        this.foodMapper = foodMapper;
        this.redisUtils = redisUtils;
        this.distributedLock = distributedLock;
        this.cacheStrategy = cacheStrategy;
        this.cacheMonitor = cacheMonitor;
        this.nutritionMapper = nutritionMapper;
        this.vitaminsMapper = vitaminsMapper;
        this.userHealthDataService = userHealthDataService;
    }

    @Cacheable(key = "#id", unless = "#result == null")
    public Food getById(Long id) {
        String key = "food:" + id;
        long startTime = System.currentTimeMillis();
        
        try {
            Food food = cacheStrategy.getWithFallback(
                key,
                Food.class,
                () -> foodMapper.selectById(id)
            );
            
            cacheMonitor.recordCacheOperation(
                food != null,
                System.currentTimeMillis() - startTime
            );
            
            return food;
        } catch (Exception e) {
            log.error("获取食物信息失败", e);
            return null;
        }
    }
    
    @Cacheable(key = "'list:' + #category")
    public List<Food> getByCategory(String category) {
        return foodMapper.selectByCategory(category);
    }
    
    @CachePut(key = "#food.id")
    @Override
    public Food updateFoodById(Food food) {
        String lockKey = "food:lock:" + food.getId();
        String lockValue = UUID.randomUUID().toString();
        
        try {
            // 获取分布式锁
            if (!distributedLock.lock(lockKey, lockValue, 30000)) {
                throw new CustomException("获取锁失败");
            }
            
            // 更新数据
            foodMapper.updateById(food);
            
            // 更新缓存
            redisTemplate.opsForValue().set(
                "food:" + food.getId(),
                food,
                1,
                TimeUnit.HOURS
            );
            
        } finally {
            // 释放锁
            distributedLock.unlock(lockKey, lockValue);
        }
        
        return food;
    }

    @Override
    public Page<Food> getAllFoods(Pageable pageable) {
        Page<Food> page = new Page<>(pageable.getPageNumber() + 1, pageable.getPageSize());
        return this.page(page);
    }

    @Override
    public List<Food> searchFoodsByName(String name) {
        return foodMapper.searchFoodsByName(name);
    }

    @Override
    public Food saveFood(Food food) {
        if (foodMapper.existsByCode(food.getCode())) {
            throw new CustomException("食物编码已存在: " + food.getCode());
        }
        foodMapper.insert(food);
        return food;
    }

    @Override
    public Food findByCode(String code) {
        return foodMapper.selectByCode(code);
    }

    @Transactional
    @Override
    public Food createFood(FoodDTO foodDTO) {
        if (foodMapper.existsByCode(foodDTO.getCode())) {
            throw new CustomException("食物编码已存在");
        }

        Food food = new Food();
        updateFoodFromDTO(food, foodDTO);
        foodMapper.insert(food);
        
        // 添加缓存
        redisUtils.set(FOOD_CACHE_KEY + food.getId(), food, FOOD_CACHE_TIME);
        return food;
    }

    @Transactional
    @Override
    public Food updateFood(Long id, FoodDTO foodDTO) {
        Food food = getFoodById(id);
        
        if (!food.getCode().equals(foodDTO.getCode()) && 
            foodMapper.existsByCode(foodDTO.getCode())) {
            throw new CustomException("食物编码已存在");
        }

        updateFoodFromDTO(food, foodDTO);
        foodMapper.updateById(food);
        
        // 更新缓存
        redisUtils.set(FOOD_CACHE_KEY + id, food, FOOD_CACHE_TIME);
        return food;
    }

    @Override
    public Food getFoodById(Long id) {
        Food food = foodMapper.selectById(id);
        if (food == null) {
            throw new CustomException("未找到指定的食物信息");
        }
        return food;
    }

    @Transactional
    @CacheEvict(key = "#id")
    @Override
    public void deleteFood(Long id) {
        Food food = getFoodById(id);
        foodMapper.deleteById(id);
        // 删除缓存
        redisUtils.delete(FOOD_CACHE_KEY + id);
    }

    @Override
    public List<Food> getHotFoods(int limit) {
        return foodMapper.selectHotFoods(limit);
    }






    @Override
    public Page<Food> getFoods(Page<Food> page, String keyword) {
        return foodMapper.selectFoods(page, keyword);
    }

    @Override
    public boolean deleteFoodById(Long id) {
        Food food = foodMapper.selectById(id);
        if (food == null) {
            return false;
        }
        food.setDeleted(1);
        foodMapper.updateById(food);
        return true;
    }

    @Override
    public void batchDeleteFoods(List<Long> foodIds) {
        foodMapper.batchDelete(foodIds);
    }

    @Override
    public Food toggleFoodStatus(Long id) {
        Food food = foodMapper.selectById(id);
        if (food == null) {
            return null;
        }
        food.setIsAvailable(food.getIsAvailable() == 1 ? 0 : 1);
        foodMapper.updateById(food);
        return food;
    }

    @Override
    public List<Food> searchFoods(String keyword) {
        return foodMapper.searchFoods(keyword);
    }

    @Override
    public List<Map<String, Object>> selectCountByField(String field) {
        return foodMapper.selectCountByField(field);
    }

    @Override
    public Food findById(Long long1) {
        return foodMapper.selectById(long1);
    }

    private void updateFoodFromDTO(Food food, FoodDTO dto) {
        food.setCode(dto.getCode());
        food.setName(dto.getName());
        food.setHealthLight(dto.getHealthLight());
        food.setHealthLabel(dto.getHealthLabel());
        food.setSuggest(dto.getSuggest());
        food.setThumbImageUrl(dto.getThumbImageUrl());
        food.setLargeImageUrl(dto.getLargeImageUrl());
//        food.setIsDynamicDish(dto.getIsDynamicDish());
        food.setContrastPhotoUrl(dto.getContrastPhotoUrl());
//        food.setIsLiquid(dto.getIsLiquid());
    }

    @Override
    public Page<Food> getFoodsByCategory(String category, int pageNum, int pageSize) {
        Page<Food> page = new Page<>(pageNum, pageSize);
        return foodMapper.selectPage(page, 
            new QueryWrapper<Food>().eq("category", category));
    }

    @Override
    public Map<String, Object> calculateNutritionScore(Long foodId) {
        Food food = foodMapper.selectById(foodId);
        if (food == null) {
            throw new RuntimeException("Food not found");
        }
        Nutrition nutrition = nutritionMapper.selectByFoodId(foodId);
        Map<String, Object> score = new HashMap<>();
        // 计算营养评分
        score.put("calories_score", calculateCaloriesScore(nutrition.getCalory()));
        score.put("protein_score", calculateProteinScore(nutrition.getProtein()));
        score.put("carbs_score", calculateCarbsScore(nutrition.getCarbohydrate()));
        score.put("fat_score", calculateFatScore(nutrition.getFat()));
        score.put("overall_score", calculateOverallScore(score));
        
        return score;
    }

    @Override
    public List<Map<String, Object>> compareNutritionInfo(List<Long> foodIds) {
        List<Map<String, Object>> comparison = new ArrayList<>();
        for (Long foodId : foodIds) {
            Food food = foodMapper.selectById(foodId);
            Nutrition nutrition = nutritionMapper.selectByFoodId(foodId);
            if (food != null) {
                Map<String, Object> info = new HashMap<>();
                info.put("food_id", food.getId());
                info.put("name", food.getName());
                info.put("calories", nutrition.getCalory());
                info.put("protein",nutrition.getProtein());
                info.put("carbohydrates",nutrition.getCarbohydrate());
                info.put("fat", nutrition.getFat());
                info.put("nutrition_score", calculateNutritionScore(foodId));
                comparison.add(info);
            }
        }
        return comparison;
    }

    @Override
    public List<Food> getPopularFoods(int limit) {
        return foodMapper.selectList(
            new QueryWrapper<Food>()
                .orderByDesc("view_count")
                .last("LIMIT " + limit)
        );
    }

    @Override
    public Map<String, Long> getCategoryStats() {
        return foodMapper.selectCategoryStats();
    }

    @Override
    public Map<String, Object> analyzeHealthIndex(Long foodId) {
        Food food = foodMapper.selectById(foodId);
        Map<String, Object> analysis = new HashMap<>();

        // 基于healthLight进行分析
        analysis.put("health_level", food.getHealthLight());
        analysis.put("health_suggestion", food.getHealthLabel());
        analysis.put("dietary_advice", food.getSuggest());

        // 添加图片相关信息
        analysis.put("food_image", food.getLargeImageUrl());
        analysis.put("comparison_image", food.getContrastPhotoUrl());

        return analysis;
    }

    @Override
    public List<Food> filterFoods(String healthLight, String healthLabel,
                                  Boolean isDynamicDish, Boolean isLiquid) {
        QueryWrapper<Food> queryWrapper = new QueryWrapper<>();

        if (healthLight != null) {
            queryWrapper.eq("health_light", healthLight);
        }
        if (healthLabel != null) {
            queryWrapper.eq("health_label", healthLabel);
        }
        if (isDynamicDish != null) {
            queryWrapper.eq("is_dynamic_dish", isDynamicDish);
        }
        if (isLiquid != null) {
            queryWrapper.eq("is_liquid", isLiquid);
        }

        return foodMapper.selectList(queryWrapper);
    }

    @Override
    public List<Food> getDailySuggestions() {
        // 基于suggest字段和其他属性提供建议
        return foodMapper.selectList(
                new QueryWrapper<Food>()
                        .isNotNull("suggest")
                        .orderByDesc("health_light")
                        .last("LIMIT 10")
        );
    }

    @Override
    public List<Food> getSimilarFoods(Long foodId, int limit) {
        Food food = foodMapper.selectById(foodId);
        if (food == null) {
            throw new RuntimeException("Food not found");
        }

        return foodMapper.selectList(new QueryWrapper<Food>()
                .eq("health_light", food.getHealthLight())
                .eq("health_label", food.getHealthLabel())
                .ne("id", foodId)
                .last("LIMIT " + limit));
    }

    @Override
    public List<Food> getSeasonalFoods(String season, int limit) {
        // 基于食品的特性和属性判断时令性
        QueryWrapper<Food> queryWrapper = new QueryWrapper<>();
        if (season != null) {
            queryWrapper.like("suggest", season); // 假设suggest字段包含季节信息
        }
        queryWrapper.orderByDesc("health_light")
                .last("LIMIT " + limit);
        return foodMapper.selectList(queryWrapper);
    }

    @Override
    public List<Food> getCurrentSeasonFoods(int limit) {
        // 获取当前季节
        String currentSeason = getCurrentSeason();
        return getSeasonalFoods(currentSeason, limit);
    }

    @Override
    public Map<String, List<Food>> getBalancedMeal(int targetCalories) {
        Map<String, List<Food>> meal = new HashMap<>();

        // 早餐占25%
        int breakfastCal = targetCalories * 25 / 100;
        meal.put("breakfast", getBalancedFoods(breakfastCal, 3));

        // 午餐占40%
        int lunchCal = targetCalories * 40 / 100;
        meal.put("lunch", getBalancedFoods(lunchCal, 4));

        // 晚餐占35%
        int dinnerCal = targetCalories * 35 / 100;
        meal.put("dinner", getBalancedFoods(dinnerCal, 4));

        return meal;
    }

    @Override
    public List<Food> getFoodSubstitutes(Long foodId, String preferenceType, int limit) {
        Food food = foodMapper.selectById(foodId);
        Nutrition nutrition = nutritionMapper.selectByFoodId(foodId);
        if (food == null) {
            throw new RuntimeException("Food not found");
        }

        QueryWrapper<Food> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("health_label", food.getHealthLabel())
                .ne("id", foodId);

        // 根据偏好类型添加条件
        if ("low_calorie".equals(preferenceType)) {
            queryWrapper.lt("calories", nutrition.getCalory());
        } else if ("high_protein".equals(preferenceType)) {
            queryWrapper.gt("protein", nutrition.getProtein());
        } else if ("low_fat".equals(preferenceType)) {
            queryWrapper.lt("fat", nutrition.getFat());
        }

        queryWrapper.orderByDesc("health_light")
                .last("LIMIT " + limit);

        return foodMapper.selectList(queryWrapper);
    }

    // 私有辅助方法
    private String getCurrentSeason() {
        Calendar cal = Calendar.getInstance();
        int month = cal.get(Calendar.MONTH) + 1;

        if (month >= 3 && month <= 5) return "春";
        if (month >= 6 && month <= 8) return "夏";
        if (month >= 9 && month <= 11) return "秋";
        return "冬";
    }

    private List<Food> getBalancedFoods(int targetCalories, int count) {
        // 获取符合目标卡路里的食品组合
        return foodMapper.selectList(
                new QueryWrapper<Food>()
                        .le("calories", targetCalories / count)
                        .orderByDesc("health_light")
                        .last("LIMIT " + count)
        );
    }

    @Override
    public List<Food> getHealthyAlternatives(Long foodId, int limit) {
        Food food = foodMapper.selectById(foodId);
        if (food == null) {
            throw new RuntimeException("Food not found");
        }

        return foodMapper.selectList(new QueryWrapper<Food>()
                .gt("health_light", food.getHealthLight())
                .eq("health_label", food.getHealthLabel())
                .ne("id", foodId)
                .orderByDesc("health_light")
                .last("LIMIT " + limit));
    }

    @Override
    public Page<Food> advancedSearch(String keyword, List<String> healthLabels,
                                     Integer minHealthLight, Integer maxHealthLight, int pageNum, int pageSize) {
        QueryWrapper<Food> queryWrapper = new QueryWrapper<>();

        if (keyword != null && !keyword.isEmpty()) {
            queryWrapper.like("name", keyword);
        }

        if (healthLabels != null && !healthLabels.isEmpty()) {
            queryWrapper.in("health_label", healthLabels);
        }

        if (minHealthLight != null) {
            queryWrapper.ge("health_light", minHealthLight);
        }

        if (maxHealthLight != null) {
            queryWrapper.le("health_light", maxHealthLight);
        }

        return foodMapper.selectPage(new Page<>(pageNum, pageSize), queryWrapper);
    }


    @Override
    public List<List<Food>> getFoodCombos(Long foodId, int limit) {
        Food food = foodMapper.selectById(foodId);
        if (food == null) {
            throw new RuntimeException("Food not found");
        }

        List<List<Food>> combos = new ArrayList<>();
        // 基于食品的healthLabel和suggest属性推荐搭配
        List<Food> complementaryFoods = foodMapper.selectList(
                new QueryWrapper<Food>()
                        .ne("id", foodId)
                        .eq("health_label", food.getHealthLabel())
                        .isNotNull("suggest")
                        .last("LIMIT " + (limit * 2))
        );

        // 生成食品组合
        for (int i = 0; i < limit && i < complementaryFoods.size() / 2; i++) {
            List<Food> combo = Arrays.asList(
                    food,
                    complementaryFoods.get(i * 2),
                    complementaryFoods.get(i * 2 + 1)
            );
            combos.add(combo);
        }

        return combos;
    }

    // 私有辅助方法
    private double calculateCaloriesScore(double calories) {
        // 实现卡路里评分逻辑
        return Math.min(100, Math.max(0, (2000 - calories) / 20));
    }

    private double calculateProteinScore(double protein) {
        // 实现蛋白质评分逻辑
        return Math.min(100, protein * 5);
    }

    private double calculateCarbsScore(double carbs) {
        // 实现碳水化合物评分逻辑
        return Math.min(100, Math.max(0, (300 - carbs) / 3));
    }

    private double calculateFatScore(double fat) {
        // 实现脂肪评分逻辑
        return Math.min(100, Math.max(0, (70 - fat) / 0.7));
    }

    private double calculateOverallScore(Map<String, Object> scores) {
        // 计算总体评分
        return ((double)scores.get("calories_score") * 0.3 +
                (double)scores.get("protein_score") * 0.3 +
                (double)scores.get("carbs_score") * 0.2 +
                (double)scores.get("fat_score") * 0.2);
    }

    @Override
    public Map<String, Integer> getFoodTagStats() {
        // 统计各健康标签的食品数量
        List<Map<String, Object>> stats = foodMapper.selectCountByField("health_label");
        Map<String, Integer> result = new HashMap<>();
        for (Map<String, Object> stat : stats) {
            result.put(
                    String.valueOf(stat.get("health_label")),
                    Integer.valueOf(String.valueOf(stat.get("total")))
            );
        }
        return result;
    }

    @Override
    public List<Food> getFoodsByTag(String tag, int pageNum, int pageSize) {
        Page<Food> page = new Page<>(pageNum, pageSize);
        return foodMapper.selectPage(page,
                new QueryWrapper<Food>()
                        .eq("health_label", tag)
                        .orderByDesc("health_light")
        ).getRecords();
    }

    @Override
    public Map<String, Object> analyzeNutrition(List<Long> foodIds) {
        Map<String, Object> analysis = new HashMap<>();
        List<Nutrition> nutritions = new ArrayList<>();

        for (Long foodId : foodIds) {
            Nutrition nutrition = nutritionMapper.selectByFoodId(foodId);
            if (nutrition != null) {
                nutritions.add(nutrition);
            }
        }

        // 计算营养总量和平均值
        double totalCalories = nutritions.stream().mapToDouble(Nutrition::getCalory).sum();
        double totalProtein = nutritions.stream().mapToDouble(Nutrition::getProtein).sum();
        double totalCarbs = nutritions.stream().mapToDouble(Nutrition::getCarbohydrate).sum();
        double totalFat = nutritions.stream().mapToDouble(Nutrition::getFat).sum();

        analysis.put("total_calories", totalCalories);
        analysis.put("total_protein", totalProtein);
        analysis.put("total_carbs", totalCarbs);
        analysis.put("total_fat", totalFat);
        analysis.put("avg_calories", totalCalories / nutritions.size());
        analysis.put("avg_protein", totalProtein / nutritions.size());
        analysis.put("avg_carbs", totalCarbs / nutritions.size());
        analysis.put("avg_fat", totalFat / nutritions.size());

        return analysis;
    }

    @Override
    public List<Food> getNutritionComplementaryFoods(Long foodId) {
        Nutrition nutrition = nutritionMapper.selectByFoodId(foodId);
        if (nutrition == null) {
            throw new RuntimeException("Nutrition not found");
        }

        // 根据营养成分的不足，推荐互补的食品
        QueryWrapper<Food> queryWrapper = new QueryWrapper<>();
        if (nutrition.getProtein() < 10) {
            queryWrapper.gt("protein", 10);
        }
        if (nutrition.getCarbohydrate() < 30) {
            queryWrapper.gt("carbohydrate", 30);
        }
        if (nutrition.getFat() < 5) {
            queryWrapper.gt("fat", 5);
        }

        queryWrapper.orderByDesc("health_light")
                .last("LIMIT 5");

        return foodMapper.selectList(queryWrapper);
    }

    @Override
    public List<Food> getHealthRanking(int limit) {
        return foodMapper.selectList(
                new QueryWrapper<Food>()
                        .orderByDesc("health_light")
                        .last("LIMIT " + limit)
        );
    }

    @Override
    public List<Food> getNutritionRanking(String type, int limit) {
        QueryWrapper<Food> queryWrapper = new QueryWrapper<>();
        switch (type.toLowerCase()) {
            case "protein":
                queryWrapper.orderByDesc("protein");
                break;
            case "fat":
                queryWrapper.orderByDesc("fat");
                break;
            case "carbs":
                queryWrapper.orderByDesc("carbohydrate");
                break;
            default:
                throw new IllegalArgumentException("Invalid nutrition type");
        }
        queryWrapper.last("LIMIT " + limit);
        return foodMapper.selectList(queryWrapper);
    }


    @Override
    public Map<String, Object> analyzeFoodTrends(String timeRange, int limit) {
        Map<String, Object> trends = new HashMap<>();

        // 获取热门食品趋势
        List<Food> popularFoods = foodMapper.selectList(
                new QueryWrapper<Food>()
                        .orderByDesc("view_count")
                        .last("LIMIT " + limit)
        );

        // 获取健康食品趋势
        List<Food> healthyFoods = foodMapper.selectList(
                new QueryWrapper<Food>()
                        .orderByDesc("health_light")
                        .last("LIMIT " + limit)
        );

        trends.put("popular_foods", popularFoods);
        trends.put("healthy_foods", healthyFoods);

        return trends;
    }

    @Override
    public List<Map<String, Object>> getComprehensiveRanking(int limit) {
        List<Map<String, Object>> ranking = new ArrayList<>();

        List<Food> foods = foodMapper.selectList(
                new QueryWrapper<Food>()
                        .last("LIMIT " + limit)
        );

        for (Food food : foods) {
            Map<String, Object> foodRank = new HashMap<>();
            foodRank.put("food", food);
            foodRank.put("health_score", food.getHealthLight());
            foodRank.put("nutrition_score", calculateNutritionScore(food.getId()));
            foodRank.put("comprehensive_score",
                    calculateComprehensiveScore(food.getHealthLight(),
                            calculateNutritionScore(food.getId())));
            ranking.add(foodRank);
        }

        // 按综合评分排序
        ranking.sort((a, b) -> Double.compare(
                (Double) b.get("comprehensive_score"),
                (Double) a.get("comprehensive_score")
        ));

        return ranking;
    }

    @Override
    public Map<String, Object> analyzeSuitableCrowd(Long foodId) {
        Map<String, Object> analysis = new HashMap<>();

        Food food = foodMapper.selectById(foodId);
        Nutrition nutrition = nutritionMapper.selectByFoodId(foodId);

        if (food == null || nutrition == null) {
            throw new RuntimeException("Food or nutrition not found");
        }

        // 分析适合人群
        List<String> suitableCrowds = new ArrayList<>();

        // 基于蛋白质含量
        if (nutrition.getProtein() > 20) {
            suitableCrowds.add("运动健身人群");
        }

        // 基于热量
        if (nutrition.getCalory() < 200) {
            suitableCrowds.add("减重人群");
        }

        // 基于健康指���
        if (food.getHealthLight() > 8) {
            suitableCrowds.add("养生保健人群");
        }

        analysis.put("suitable_crowds", suitableCrowds);
        analysis.put("nutrition_features", analyzeNutritionFeatures(nutrition));
        analysis.put("health_suggestions", generateHealthSuggestions(food, nutrition));

        return analysis;
    }
    // 私有辅助方法
    private double calculateComprehensiveScore(int healthLight, Map<String, Object> nutritionScore) {
        double healthWeight = 0.4;
        double nutritionWeight = 0.6;

        return healthLight * healthWeight +
                (double)nutritionScore.get("overall_score") * nutritionWeight;
    }

    private Map<String, String> analyzeNutritionFeatures(Nutrition nutrition) {
        Map<String, String> features = new HashMap<>();

        if (nutrition.getProtein() > 20) {
            features.put("protein", "高蛋白");
        }
        if (nutrition.getCarbohydrate() < 20) {
            features.put("carbs", "低碳水");
        }
        if (nutrition.getFat() < 5) {
            features.put("fat", "低脂肪");
        }

        return features;
    }

    private List<String> generateHealthSuggestions(Food food, Nutrition nutrition) {
        List<String> suggestions = new ArrayList<>();

        if (nutrition.getCalory() > 300) {
            suggestions.add("建议适量食用，控制portion size");
        }
        if (food.getHealthLight() < 5) {
            suggestions.add("建议搭配新鲜蔬菜水果");
        }

        return suggestions;
    }

    @Override
    public Map<String, Object> analyzeVitamins(Long foodId) {
        Map<String, Object> analysis = new HashMap<>();

        Food food = foodMapper.selectById(foodId);
        Vitamins vitamins = vitaminsMapper.selectByFoodId(foodId);

        if (food == null || vitamins == null) {
            throw new RuntimeException("Food or vitamins not found");
        }

        // 分析维生素含量
        Map<String, Object> vitaminLevels = new HashMap<>();
        vitaminLevels.put("vitamin_a", analyzeVitaminLevel("A", vitamins.getVitaminA()));
//        vitaminLevels.put("vitamin_b", analyzeVitaminLevel("B", vitamins.getVitaminB()));
        vitaminLevels.put("vitamin_c", analyzeVitaminLevel("C", vitamins.getVitaminC()));
        vitaminLevels.put("vitamin_d", analyzeVitaminLevel("D", vitamins.getVitaminD()));
        vitaminLevels.put("vitamin_e", analyzeVitaminLevel("E", vitamins.getVitaminE()));

        analysis.put("vitamin_levels", vitaminLevels);
        analysis.put("daily_recommendations", generateVitaminRecommendations(vitamins));
        analysis.put("health_benefits", analyzeVitaminBenefits(vitamins));

        return analysis;
    }

    @Override
    public List<Map<String, Object>> getVitaminRanking(String type, int limit) {
        List<Map<String, Object>> ranking = new ArrayList<>();

        // 根据维生素类型获取排行
        String column = "vitamin_" + type.toLowerCase();
        List<Vitamins> vitaminsList = vitaminsMapper.selectList(
                new QueryWrapper<Vitamins>()
                        .orderByDesc(column)
                        .last("LIMIT " + limit)
        );

        for (Vitamins vitamins : vitaminsList) {
            Map<String, Object> item = new HashMap<>();
            Food food = foodMapper.selectById(vitamins.getFoodId());
            item.put("food", food);
            item.put("vitamin_content", getVitaminContent(vitamins, type));
            item.put("percentage_dri", calculateDRIPercentage(vitamins, type));
            ranking.add(item);
        }

        return ranking;
    }

    @Override
    public Map<String, Object> getComprehensiveAnalysis(Long foodId) {
        Map<String, Object> analysis = new HashMap<>();

        Food food = foodMapper.selectById(foodId);
        Nutrition nutrition = nutritionMapper.selectByFoodId(foodId);
        Vitamins vitamins = vitaminsMapper.selectByFoodId(foodId);

        if (food == null || nutrition == null || vitamins == null) {
            throw new RuntimeException("Food, nutrition or vitamins not found");
        }

        // 基础信息
        analysis.put("food_info", food);

        // 营养素分析
        analysis.put("nutrition_analysis", analyzeNutrition(Arrays.asList(foodId)));

        // 维生素分析
        analysis.put("vitamin_analysis", analyzeVitamins(foodId));

        // 健康评分
        analysis.put("health_score", calculateHealthScore(food, nutrition, vitamins));

        // 膳食建议
        analysis.put("dietary_suggestions", generateDietarySuggestions(food, nutrition, vitamins));

        return analysis;
    }
    // 私有辅助方法
    private Map<String, String> analyzeVitaminLevel(String type, double content) {
        Map<String, String> analysis = new HashMap<>();
        String level;
        String suggestion;

        // 根据不同维生素类型判断含量水平
        switch (type) {
            case "A":
                if (content > 800) level = "高";
                else if (content > 400) level = "中";
                else level = "低";
                break;
            // ... 其他维生素类型的判断逻辑
            default:
                level = "未知";
        }

        analysis.put("level", level);
        analysis.put("suggestion", generateVitaminSuggestion(type, level));

        return analysis;
    }

    private List<String> generateVitaminRecommendations(Vitamins vitamins) {
        List<String> recommendations = new ArrayList<>();

        if (vitamins.getVitaminA() < 400) {
            recommendations.add("建议增加胡萝卜等富含维生素A的食物");
        }
        if (vitamins.getVitaminC() < 60) {
            recommendations.add("建议增加柑橘类水果补充维生素C");
        }
        // ... 其他维生素的建议

        return recommendations;
    }

    private Map<String, String> analyzeVitaminBenefits(Vitamins vitamins) {
        Map<String, String> benefits = new HashMap<>();

        if (vitamins.getVitaminA() > 800) {
            benefits.put("vision", "有助于视力健康");
        }
        if (vitamins.getVitaminC() > 100) {
            benefits.put("immunity", "增强免疫力");
        }
        // ... 其他维生素的功效

        return benefits;
    }

    // 生成维生素建议
    private String generateVitaminSuggestion(String type, String level) {
        if ("低".equals(level)) {
            switch (type) {
                case "A":
                    return "建议多食用胡萝卜、菠菜等深色蔬菜";
                case "C":
                    return "建议多食用柑橘类水果、猕猴桃等";
                case "D":
                    return "建议适当进行日光浴，多食用鱼类、蛋类";
                case "E":
                    return "建议多食用坚果、植物油等";
                default:
                    return "建议均衡饮食";
            }
        }
        return "维生素含量适中，继续保持";
    }

    // 计算健康评分
    private double calculateHealthScore(Food food, Nutrition nutrition, Vitamins vitamins) {
        double healthScore = 0;

        // 基础健康分数（占40%）
        healthScore += food.getHealthLight() * 4;

        // 营养评分（占30%）
        double nutritionScore = 0;
        nutritionScore += nutrition.getProtein() * 0.4;
        nutritionScore += nutrition.getCarbohydrate() * 0.3;
        nutritionScore += (100 - nutrition.getFat()) * 0.3;
        healthScore += nutritionScore * 0.3;

        // 维生素评分（占30%）
        double vitaminScore = 0;
        vitaminScore += calculateVitaminScore(vitamins.getVitaminA(), 800) * 0.25;
        vitaminScore += calculateVitaminScore(vitamins.getVitaminC(), 100) * 0.25;
        vitaminScore += calculateVitaminScore(vitamins.getVitaminD(), 20) * 0.25;
        vitaminScore += calculateVitaminScore(vitamins.getVitaminE(), 15) * 0.25;
        healthScore += vitaminScore * 0.3;

        return Math.min(100, healthScore);
    }

    // 计算单个维生素的评分
    private double calculateVitaminScore(double content, double recommendedValue) {
        if (content >= recommendedValue) {
            return 100;
        }
        return (content / recommendedValue) * 100;
    }

    // 生成膳食建议
    private List<String> generateDietarySuggestions(Food food, Nutrition nutrition, Vitamins vitamins) {
        List<String> suggestions = new ArrayList<>();

        // 基于健康指数的建议
        if (food.getHealthLight() < 6) {
            suggestions.add("建议适量食用，注意搭配其他健康食品");
        }

        // 基于营养的建议
        if (nutrition.getCalory() > 300) {
            suggestions.add("热量较高，建议控制食用量");
        }
        if (nutrition.getProtein() < 10) {
            suggestions.add("蛋白质含量较低，建议搭配高蛋白食物");
        }

        // 基于维生素的建议
        if (vitamins.getVitaminA() < 400) {
            suggestions.add("维生素A含量较低，建议搭配胡萝卜等食物");
        }
        if (vitamins.getVitaminC() < 60) {
            suggestions.add("维生素C含量较低，建议搭配水果");
        }

        return suggestions;
    }

    // 获取维生素含量
    private double getVitaminContent(Vitamins vitamins, String type) {
        switch (type.toUpperCase()) {
            case "A":
                return vitamins.getVitaminA();
            case "C":
                return vitamins.getVitaminC();
            case "D":
                return vitamins.getVitaminD();
            case "E":
                return vitamins.getVitaminE();
            default:
                throw new IllegalArgumentException("Unsupported vitamin type: " + type);
        }
    }

    // 计算每日推荐摄入量的百分比
    private double calculateDRIPercentage(Vitamins vitamins, String type) {
        double content = getVitaminContent(vitamins, type);
        double dri = getDailyRecommendedIntake(type);
        return (content / dri) * 100;
    }

    // 获取维生素每日推荐摄入量
    private double getDailyRecommendedIntake(String type) {
        switch (type.toUpperCase()) {
            case "A":
                return 800; // μg
            case "C":
                return 100; // mg
            case "D":
                return 20;  // μg
            case "E":
                return 15;  // mg
            default:
                throw new IllegalArgumentException("Unsupported vitamin type: " + type);
        }
    }

    @Override
    public List<Food> getHealthBasedRecommendations(Long userId) {
        UserHealthData healthData = userHealthDataService.getUserHealthData(userId);
        List<Food> recommendations = new ArrayList<>();
        
        // 检查血压
        if (healthData.getBloodPressureHigh() > 140 || healthData.getBloodPressureLow() > 90) {
            // 推荐低钠食品
            recommendations.addAll(foodMapper.selectList(
                new QueryWrapper<Food>()
                    .eq("health_label", "低钠")
                    .orderByDesc("health_light")
                    .last("LIMIT 5")
            ));
        }
        
        // 检查血糖
        if (healthData.getBloodSugar() > 7.0) {
            // 推荐低糖食品
            recommendations.addAll(foodMapper.selectList(
                new QueryWrapper<Food>()
                    .eq("health_label", "低糖")
                    .orderByDesc("health_light")
                    .last("LIMIT 5")
            ));
        }
        
        // 检查胆固醇
        if (healthData.getCholesterolLevel() > 5.2) {
            // 推荐低脂食品
            recommendations.addAll(foodMapper.selectList(
                new QueryWrapper<Food>()
                    .eq("health_label", "低脂")
                    .orderByDesc("health_light")
                    .last("LIMIT 5")
            ));
        }
        
        return recommendations;
    }

    @Override
    public Map<String, Object> getBMIBasedAdvice(Long userId) {
        Map<String, Object> advice = new HashMap<>();
        UserHealthData healthData = userHealthDataService.getUserHealthData(userId);
        
        float bmi = calculateBMI(healthData.getWeight(), healthData.getHeight());
        String bmiCategory = getBMICategory(bmi);
        
        advice.put("bmi", bmi);
        advice.put("category", bmiCategory);
        
        // 根据BMI类别提供建议
        if (bmi < 18.5) {
            // 推荐高蛋白、高热量食品
            advice.put("recommendations", foodMapper.selectList(
                new QueryWrapper<Food>()
                    .gt("calories", 300)
                    .gt("protein", 15)
                    .orderByDesc("health_light")
                    .last("LIMIT 10")
            ));
        } else if (bmi > 25) {
            // 推荐低热量、高纤维食品
            advice.put("recommendations", foodMapper.selectList(
                new QueryWrapper<Food>()
                    .lt("calories", 300)
                    .eq("health_label", "高纤维")
                    .orderByDesc("health_light")
                    .last("LIMIT 10")
            ));
        }
        
        return advice;
    }

    @Override
    public Map<String, Object> getActivityBasedAdvice(Long userId) {
        Map<String, Object> advice = new HashMap<>();
        UserHealthData healthData = userHealthDataService.getUserHealthData(userId);
        
        int activityLevel = healthData.getActivityLevel();
        int dailyCalorieTarget = healthData.getDailyCalorieTarget();
        
        // 根据活动水平调整推荐
        switch (activityLevel) {
            case 1: // 久坐
                advice.put("calorie_adjustment", "建议减少" + (dailyCalorieTarget * 0.1) + "卡路里");
                break;
            case 2: // 轻度活动
                advice.put("calorie_adjustment", "当前卡路里摄入适中");
                break;
            case 3: // 中度活动
                advice.put("calorie_adjustment", "建议增加" + (dailyCalorieTarget * 0.1) + "卡路里");
                break;
            case 4: // 重度活动
                advice.put("calorie_adjustment", "建议增加" + (dailyCalorieTarget * 0.2) + "卡路里");
                break;
        }
        
        // 推荐食品
        advice.put("recommended_foods", getActivityLevelFoods(activityLevel));
        
        return advice;
    }

    @Override
    public Map<String, List<Food>> getPersonalizedDailyMenu(Long userId) {
        Map<String, List<Food>> menu = new HashMap<>();
        UserHealthData healthData = userHealthDataService.getUserHealthData(userId);
        
        int dailyCalorieTarget = healthData.getDailyCalorieTarget();
        
        // 早餐 (30%)
        int breakfastCalories = (int)(dailyCalorieTarget * 0.3);
        menu.put("breakfast", getBalancedMealFoods(breakfastCalories, 3));
        
        // 午餐 (40%)
        int lunchCalories = (int)(dailyCalorieTarget * 0.4);
        menu.put("lunch", getBalancedMealFoods(lunchCalories, 4));
        
        // 晚餐 (30%)
        int dinnerCalories = (int)(dailyCalorieTarget * 0.3);
        menu.put("dinner", getBalancedMealFoods(dinnerCalories, 4));
        
        return menu;
    }

    @Override
    public List<Map<String, Object>> getGoalOrientedRecommendations(Long userId, String healthGoal) {
        List<Map<String, Object>> recommendations = new ArrayList<>();
        UserHealthData healthData = userHealthDataService.getUserHealthData(userId);
        
        switch (healthGoal.toLowerCase()) {
            case "weight-loss":
                recommendations = getWeightLossRecommendations(healthData);
                break;
            case "muscle-gain":
                recommendations = getMuscleGainRecommendations(healthData);
                break;
            case "blood-sugar-control":
                recommendations = getBloodSugarControlRecommendations(healthData);
                break;
        }
        
        return recommendations;
    }

    @Override
    public Map<String, Object> getHealthConditionAdvice(Long userId, String condition) {
        Map<String, Object> advice = new HashMap<>();
        UserHealthData healthData = userHealthDataService.getUserHealthData(userId);
        
        switch (condition.toLowerCase()) {
            case "high-blood-pressure":
                advice = getHighBloodPressureAdvice(healthData);
                break;
            case "diabetes":
                advice = getDiabetesAdvice(healthData);
                break;
            case "high-cholesterol":
                advice = getHighCholesterolAdvice(healthData);
                break;
        }
        
        return advice;
    }

    @Override
    public Map<String, Object> getNutritionBalanceAssessment(Long userId) {
        Map<String, Object> assessment = new HashMap<>();
        UserHealthData healthData = userHealthDataService.getUserHealthData(userId);
        
        // 计算每日所需营养素
        Map<String, Double> dailyNutrients = calculateDailyNutrients(healthData);
        assessment.put("daily_nutrients_needed", dailyNutrients);
        
        // 分析营养摄入平衡性
        assessment.put("balance_analysis", analyzeNutritionBalance(healthData));
        
        // 提供改善建议
        assessment.put("improvement_suggestions", generateNutritionSuggestions(healthData));
        
        return assessment;
    }

    // 私有辅助方法
    private float calculateBMI(float weight, float height) {
        return weight / ((height / 100) * (height / 100));
    }

    private String getBMICategory(float bmi) {
        if (bmi < 18.5) return "偏瘦";
        if (bmi < 24) return "正常";
        if (bmi < 28) return "偏胖";
        return "肥胖";
    }

    private List<Food> getActivityLevelFoods(int activityLevel) {
        QueryWrapper<Food> queryWrapper = new QueryWrapper<>();
        
        switch (activityLevel) {
            case 1: // 久坐
                queryWrapper.lt("calories", 300);
                break;
            case 2: // 轻度活动
                queryWrapper.between("calories", 300, 400);
                break;
            case 3: // 中度活动
                queryWrapper.between("calories", 400, 500);
                break;
            case 4: // 重度活动
                queryWrapper.gt("calories", 500);
                break;
        }
        
        queryWrapper.orderByDesc("health_light")
                   .last("LIMIT 10");
        
        return foodMapper.selectList(queryWrapper);
    }

    private List<Food> getBalancedMealFoods(int targetCalories, int count) {
        return foodMapper.selectList(
            new QueryWrapper<Food>()
                .le("calories", targetCalories / count)
                .orderByDesc("health_light")
                .last("LIMIT " + count)
        );
    }

    // 获取减重建议
    private List<Map<String, Object>> getWeightLossRecommendations(UserHealthData healthData) {
        List<Map<String, Object>> recommendations = new ArrayList<>();

        // 获取低热量食品
        List<Food> lowCalorieFoods = foodMapper.selectList(
                new QueryWrapper<Food>()
                        .lt("calories", 300)
                        .orderByDesc("health_light")
                        .last("LIMIT 5")
        );

        // 获取高蛋白低脂食品
        List<Food> highProteinFoods = foodMapper.selectList(
                new QueryWrapper<Food>()
                        .gt("protein", 15)
                        .lt("fat", 10)
                        .orderByDesc("health_light")
                        .last("LIMIT 5")
        );

        Map<String, Object> recommendation = new HashMap<>();
        recommendation.put("category", "低热量食品");
        recommendation.put("foods", lowCalorieFoods);
        recommendation.put("suggestion", "建议选择热量较低的食品，控制总热量摄入");
        recommendations.add(recommendation);

        recommendation = new HashMap<>();
        recommendation.put("category", "高蛋白食品");
        recommendation.put("foods", highProteinFoods);
        recommendation.put("suggestion", "适量增加蛋白质摄入，有助于保持肌肉量");
        recommendations.add(recommendation);

        return recommendations;
    }

    // 获取增肌建议
    private List<Map<String, Object>> getMuscleGainRecommendations(UserHealthData healthData) {
        List<Map<String, Object>> recommendations = new ArrayList<>();

        // 获取高蛋白食品
        List<Food> highProteinFoods = foodMapper.selectList(
                new QueryWrapper<Food>()
                        .gt("protein", 20)
                        .orderByDesc("health_light")
                        .last("LIMIT 5")
        );

        // 获取优质碳水食品
        List<Food> qualityCarbsFoods = foodMapper.selectList(
                new QueryWrapper<Food>()
                        .gt("carbohydrate", 30)
                        .eq("health_label", "全谷物")
                        .orderByDesc("health_light")
                        .last("LIMIT 5")
        );

        Map<String, Object> recommendation = new HashMap<>();
        recommendation.put("category", "高蛋白食品");
        recommendation.put("foods", highProteinFoods);
        recommendation.put("suggestion", "增加优质蛋白质摄入，支持肌肉生长");
        recommendations.add(recommendation);

        recommendation = new HashMap<>();
        recommendation.put("category", "优质碳水食品");
        recommendation.put("foods", qualityCarbsFoods);
        recommendation.put("suggestion", "适量补充优质碳水，为训练提供能量");
        recommendations.add(recommendation);

        return recommendations;
    }
    // 获取血糖控制建议
    private List<Map<String, Object>> getBloodSugarControlRecommendations(UserHealthData healthData) {
        List<Map<String, Object>> recommendations = new ArrayList<>();

        // 获取低GI食品
        List<Food> lowGIFoods = foodMapper.selectList(
                new QueryWrapper<Food>()
                        .eq("health_label", "低血糖生成指数")
                        .orderByDesc("health_light")
                        .last("LIMIT 5")
        );

        // 获取高纤维食品
        List<Food> highFiberFoods = foodMapper.selectList(
                new QueryWrapper<Food>()
                        .eq("health_label", "高纤维")
                        .orderByDesc("health_light")
                        .last("LIMIT 5")
        );

        Map<String, Object> recommendation = new HashMap<>();
        recommendation.put("category", "低GI食品");
        recommendation.put("foods", lowGIFoods);
        recommendation.put("suggestion", "选择低血糖生成指数的食品，避免血糖快速升高");
        recommendations.add(recommendation);

        recommendation = new HashMap<>();
        recommendation.put("category", "高纤维食品");
        recommendation.put("foods", highFiberFoods);
        recommendation.put("suggestion", "增加膳食纤维摄入，有助于稳定血糖");
        recommendations.add(recommendation);

        return recommendations;
    }

    // 获取高血压饮食建议
    private Map<String, Object> getHighBloodPressureAdvice(UserHealthData healthData) {
        Map<String, Object> advice = new HashMap<>();

        // 获取低钠食品
        List<Food> lowSodiumFoods = foodMapper.selectList(
                new QueryWrapper<Food>()
                        .eq("health_label", "低钠")
                        .orderByDesc("health_light")
                        .last("LIMIT 10")
        );

        advice.put("condition", "高血压");
        advice.put("recommended_foods", lowSodiumFoods);
        advice.put("dietary_principles", Arrays.asList(
                "控制钠盐摄入",
                "增加钾的摄入",
                "保持适度运动",
                "控制体重"
        ));

        return advice;
    }


    // 获取糖尿病饮食建议
    private Map<String, Object> getDiabetesAdvice(UserHealthData healthData) {
        Map<String, Object> advice = new HashMap<>();

        // 获取低GI食品
        List<Food> lowGIFoods = foodMapper.selectList(
                new QueryWrapper<Food>()
                        .eq("health_label", "低血糖生成指数")
                        .orderByDesc("health_light")
                        .last("LIMIT 10")
        );

        advice.put("condition", "糖尿病");
        advice.put("recommended_foods", lowGIFoods);
        advice.put("dietary_principles", Arrays.asList(
                "控制碳水化合物摄入",
                "选择低GI食品",
                "增加膳食纤维摄入",
                "规律进餐"
        ));

        return advice;
    }

    // 获取高胆固醇饮食建议
    private Map<String, Object> getHighCholesterolAdvice(UserHealthData healthData) {
        Map<String, Object> advice = new HashMap<>();

        // 获取低脂食品
        List<Food> lowFatFoods = foodMapper.selectList(
                new QueryWrapper<Food>()
                        .lt("fat", 5)
                        .orderByDesc("health_light")
                        .last("LIMIT 10")
        );

        advice.put("condition", "高胆固醇");
        advice.put("recommended_foods", lowFatFoods);
        advice.put("dietary_principles", Arrays.asList(
                "减少饱和脂肪摄入",
                "增加膳食纤维摄入",
                "选择富含不饱和脂肪酸的食物",
                "控制总脂肪摄入"
        ));

        return advice;
    }

    // 计算每日所需营养素
    private Map<String, Double> calculateDailyNutrients(UserHealthData healthData) {
        Map<String, Double> nutrients = new HashMap<>();

        // 基础代谢率计算
        double bmr;
        if (healthData.getGender() == 1) { // 男性
            bmr = 66 + (13.7 * healthData.getWeight()) + (5 * healthData.getHeight()) - (6.8 * healthData.getAge());
        } else { // 女性
            bmr = 655 + (9.6 * healthData.getWeight()) + (1.8 * healthData.getHeight()) - (4.7 * healthData.getAge());
        }

        // 根据活动水平调整
        double activityFactor;
        switch (healthData.getActivityLevel()) {
            case 1 :
                activityFactor = 1.2;  // 久坐
                break;
            case 2 :
                activityFactor = 1.375;  // 轻度活动
                break;
            case 3 :
                activityFactor = 1.55;  // 中度活动
                break;
            case 4 :
                activityFactor = 1.725;  // 重度活动
                break;
            default :
                activityFactor = 1.2;
        };

        double dailyCalories = bmr * activityFactor;

        // 计算各营养素需求
        nutrients.put("calories", dailyCalories);
        nutrients.put("protein", healthData.getWeight() * 1.2); // 每公斤体重1.2g蛋白质
        nutrients.put("carbs", dailyCalories * 0.5 / 4); // 50%热量来自碳水，1g碳水4卡路里
        nutrients.put("fat", dailyCalories * 0.3 / 9); // 30%热量来自脂肪，1g脂肪9卡路里

        return nutrients;
    }

    // 分析营养摄入平衡性
    private Map<String, Object> analyzeNutritionBalance(UserHealthData healthData) {
        Map<String, Object> analysis = new HashMap<>();

        // 获取用户的实际营养摄入（这里需要实现获取用户实际摄入的逻辑）
        Map<String, Double> actualIntake = new HashMap<>(); // 示例数据
        Map<String, Double> recommendedIntake = calculateDailyNutrients(healthData);

        // 计算各营养素的摄入比例
        Map<String, Double> nutritionRatio = new HashMap<>();
        for (String nutrient : recommendedIntake.keySet()) {
            double actual = actualIntake.getOrDefault(nutrient, 0.0);
            double recommended = recommendedIntake.get(nutrient);
            nutritionRatio.put(nutrient, actual / recommended * 100);
        }

        analysis.put("nutrition_ratio", nutritionRatio);
        analysis.put("is_balanced", isNutritionBalanced(nutritionRatio));

        return analysis;
    }
    // 生成营养建议
    private List<String> generateNutritionSuggestions(UserHealthData healthData) {
        List<String> suggestions = new ArrayList<>();
        Map<String, Object> balance = analyzeNutritionBalance(healthData);
        Map<String, Double> ratio = (Map<String, Double>) balance.get("nutrition_ratio");

        // 根据营养比例生成建议
        if (ratio.get("protein") < 80) {
            suggestions.add("蛋白质摄入不足，建议增加瘦肉、鱼类、蛋类等优质蛋白的摄入");
        }
        if (ratio.get("carbs") > 120) {
            suggestions.add("碳水化合物摄入过多，建议适当减少主食摄入");
        }
        if (ratio.get("fat") > 110) {
            suggestions.add("脂肪摄入过多，建议减少油炸食品摄入，选择烤、煮等烹饪方式");
        }

        return suggestions;
    }

    // 判断营养是否平衡
    private boolean isNutritionBalanced(Map<String, Double> nutritionRatio) {
        // 判断各营养素是否在合理范围内（80%-120%）
        return nutritionRatio.values().stream()
                .allMatch(ratio -> ratio >= 80 && ratio <= 120);
    }
} 