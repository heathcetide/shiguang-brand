package com.foodrecord.controller.user;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.FoodRecommendationDTO;
import com.foodrecord.model.entity.FoodRecommendation;
import com.foodrecord.service.impl.FoodRecommendationServiceImpl;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;
import java.util.List;

@RestController
@RequestMapping("/api/recommendations")
public class FoodRecommendationController {
    private final FoodRecommendationServiceImpl recommendationService;

    public FoodRecommendationController(FoodRecommendationServiceImpl recommendationService) {
        this.recommendationService = recommendationService;
    }

    @GetMapping("/user/{userId}")
    public ApiResponse<IPage<FoodRecommendation>> getPageByUserId(
            @PathVariable Long userId,
            @RequestParam(required = false) String type,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int size) {
        return ApiResponse.success(recommendationService.getPageByUserId(userId, type, page, size));
    }

    @GetMapping("/user/{userId}/top")
    public ApiResponse<List<FoodRecommendation>> getTopRecommendations(
            @PathVariable Long userId,
            @RequestParam String type,
            @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(recommendationService.getTopRecommendations(userId, type, limit));
    }

    @PostMapping
    public ApiResponse<FoodRecommendation> createOrUpdate(@Valid @RequestBody FoodRecommendationDTO dto) {
        return ApiResponse.success(recommendationService.createOrUpdate(dto));
    }

    @PostMapping("/user/{userId}/health-goal")
    public ApiResponse<Boolean> generateHealthGoalRecommendations(@PathVariable Long userId) {
        recommendationService.generateHealthGoalRecommendations(userId);
        return ApiResponse.success(true);
    }

    @PostMapping("/user/{userId}/nutrition-balance")
    public ApiResponse<Boolean> generateNutritionBalanceRecommendations(@PathVariable Long userId) {
        recommendationService.generateNutritionBalanceRecommendations(userId);
        return ApiResponse.success(true);
    }
} 