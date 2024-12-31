package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.dto.FoodDTO;
import com.foodrecord.model.entity.Food;
import org.springframework.data.domain.Pageable;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

public interface FoodService extends IService<Food> {
    Food getById(Long id);

    List<Food> getByCategory(String category);

    Food createFood(FoodDTO foodDTO);

    Food updateFood(Long id, FoodDTO foodDTO);

    Food getFoodById(Long id);

    void deleteFood(Long id);

    List<Food> getHotFoods(int limit);

    Food updateFoodById(Food food);

    /**
     * 分页获取所有食物
     *
     * @param pageable 分页信息
     * @return 分页的食物数据
     */
    Page<Food> getAllFoods(Pageable pageable);

    List<Food> searchFoodsByName(String name);

    Food saveFood(Food food);

    Food findByCode(String code);

    Page<Food> getFoods(Page<Food> page, String keyword);

    boolean deleteFoodById(Long id);

    void batchDeleteFoods(List<Long> foodIds);

    Food toggleFoodStatus(Long id);

    List<Food> searchFoods(String keyword);

    List<Map<String, Object>> selectCountByField(String field);

    Food findById(Long long1);

    Page<Food> getFoodsByCategory(String category, int pageNum, int pageSize);
    
    Map<String, Object> calculateNutritionScore(Long foodId);
    
    List<Map<String, Object>> compareNutritionInfo(List<Long> foodIds);
    
    List<Food> getPopularFoods(int limit);
    
    Map<String, Long> getCategoryStats();

    Map<String, Object> analyzeHealthIndex(Long foodId);

    List<Food> filterFoods(String healthLight, String healthLabel, Boolean isDynamicDish, Boolean isLiquid);

    List<Food> getDailySuggestions();

    List<List<Food>> getFoodCombos(Long foodId, int limit);

    Page<Food> advancedSearch(String keyword, List<String> healthLabels, Integer minHealthLight, Integer maxHealthLight, int pageNum, int pageSize);

    List<Food> getHealthyAlternatives(Long foodId, int limit);

    List<Food> getSimilarFoods(Long foodId, int limit);

    List<Food> getFoodSubstitutes(Long foodId, String preferenceType, int limit);

    Map<String, List<Food>> getBalancedMeal(int targetCalories);

    List<Food> getCurrentSeasonFoods(int limit);

    List<Food> getSeasonalFoods(String season, int limit);

    List<Food> getNutritionRanking(String type, int limit);

    List<Food> getHealthRanking(int limit);

    List<Food> getNutritionComplementaryFoods(Long foodId);

    Map<String, Object> analyzeNutrition(List<Long> foodIds);

    List<Food> getFoodsByTag(String tag, int pageNum, int pageSize);

    Map<String, Integer> getFoodTagStats();

    Map<String, Object> analyzeSuitableCrowd(Long foodId);

    List<Map<String, Object>> getComprehensiveRanking(int limit);

    Map<String, Object> analyzeFoodTrends(String timeRange, int limit);

    Map<String, Object> getComprehensiveAnalysis(Long foodId);

    List<Map<String, Object>> getVitaminRanking(String type, int limit);

    Map<String, Object> analyzeVitamins(Long foodId);

    Map<String, Object> getNutritionBalanceAssessment(Long id);

    Map<String, Object> getHealthConditionAdvice(Long id, String condition);

    List<Map<String, Object>> getGoalOrientedRecommendations(Long id, String healthGoal);

    Map<String, List<Food>> getPersonalizedDailyMenu(Long id);

    Map<String, Object> getActivityBasedAdvice(Long id);

    Map<String, Object> getBMIBasedAdvice(Long id);

    List<Food> getHealthBasedRecommendations(Long id);
}
