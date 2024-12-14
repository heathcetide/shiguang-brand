package com.foodrecord.service;

import com.foodrecord.model.dto.NutritionDTO;
import com.foodrecord.model.entity.Nutrition;

public interface NutritionService {

    Nutrition getNutritionByFoodId(Long foodId);

    Nutrition createNutrition(NutritionDTO nutritionDTO);

    Nutrition updateNutrition(Long foodId, NutritionDTO nutritionDTO);

    void deleteNutrition(Long foodId);

    void save(Nutrition nutrition);
}
