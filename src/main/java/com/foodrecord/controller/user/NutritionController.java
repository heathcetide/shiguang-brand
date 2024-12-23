package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.NutritionDTO;
import com.foodrecord.model.entity.Nutrition;
import com.foodrecord.service.impl.NutritionServiceImpl;
import io.swagger.annotations.Api;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;

@RestController
@RequestMapping("/api/nutrition")
@Api(tags = "营养物质模块[不重要]")
public class NutritionController {
    private final NutritionServiceImpl nutritionService;

    public NutritionController(NutritionServiceImpl nutritionService) {
        this.nutritionService = nutritionService;
    }

    @GetMapping("/food/{foodId}")
    public ApiResponse<Nutrition> getNutritionByFoodId(@PathVariable Long foodId) {
        return ApiResponse.success(nutritionService.getNutritionByFoodId(foodId));
    }

    @PostMapping
    public ApiResponse<Nutrition> createNutrition(@Valid @RequestBody NutritionDTO nutritionDTO) {
        return ApiResponse.success(nutritionService.createNutrition(nutritionDTO));
    }

    @PutMapping("/food/{foodId}")
    public ApiResponse<Nutrition> updateNutrition(
            @PathVariable Long foodId,
            @Valid @RequestBody NutritionDTO nutritionDTO) {
        return ApiResponse.success(nutritionService.updateNutrition(foodId, nutritionDTO));
    }

    @DeleteMapping("/food/{foodId}")
    public ApiResponse<Void> deleteNutrition(@PathVariable Long foodId) {
        nutritionService.deleteNutrition(foodId);
        return ApiResponse.success(null);
    }
} 