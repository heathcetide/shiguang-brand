package com.foodrecord.service.impl;

import com.foodrecord.exception.CustomException;
import com.foodrecord.mapper.FoodMapper;
import com.foodrecord.mapper.NutritionMapper;
import com.foodrecord.model.dto.NutritionDTO;
import com.foodrecord.model.entity.Food;
import com.foodrecord.model.entity.Nutrition;
import com.foodrecord.service.NutritionService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;

@Service
public class NutritionServiceImpl implements NutritionService {

    @Resource
    private NutritionMapper nutritionMapper;
    @Resource
    private FoodMapper foodMapper;

    @Override
    public Nutrition getNutritionByFoodId(Long foodId) {
        return nutritionMapper.findByFoodId(foodId)
                .orElseThrow(() -> new CustomException("营养信息不存在"));
    }

    @Override
    @Transactional
    public Nutrition createNutrition(NutritionDTO nutritionDTO) {
        Food food = foodMapper.selectById(nutritionDTO.getFoodId());
        if (food == null) {
            throw new CustomException("食物不存在");
        }

        if (nutritionMapper.findByFoodId(nutritionDTO.getFoodId()).isPresent()) {
            throw new CustomException("该食物的营养信息已存在");
        }

        Nutrition nutrition = new Nutrition();
        nutrition.setFoodId(food.getId());
        updateNutritionFromDTO(nutrition, nutritionDTO);
        nutritionMapper.insert(nutrition);
        return nutrition;
    }

    @Override
    @Transactional
    public Nutrition updateNutrition(Long foodId, NutritionDTO nutritionDTO) {
        Nutrition nutrition = getNutritionByFoodId(foodId);
        updateNutritionFromDTO(nutrition, nutritionDTO);
        nutritionMapper.insert(nutrition);
        return nutrition;
    }

    private void updateNutritionFromDTO(Nutrition nutrition, NutritionDTO dto) {
        nutrition.setCalory(dto.getCalory());
        nutrition.setProtein(dto.getProtein());
        nutrition.setFat(dto.getFat());
        nutrition.setCarbohydrate(dto.getCarbohydrate());
        nutrition.setFiberDietary(dto.getFiberDietary());
        nutrition.setNatrium(dto.getNatrium());
        nutrition.setCalcium(dto.getCalcium());
        nutrition.setPotassium(dto.getPotassium());
        nutrition.setIron(dto.getIron());
        nutrition.setSelenium(dto.getSelenium());
    }

    @Transactional
    @Override
    public void deleteNutrition(Long foodId) {
        Nutrition nutrition = getNutritionByFoodId(foodId);
        nutritionMapper.deleteNutrition(nutrition.getId());
    }

    @Override
    public void save(Nutrition nutrition) {
        nutritionMapper.insert(nutrition);
    }
} 