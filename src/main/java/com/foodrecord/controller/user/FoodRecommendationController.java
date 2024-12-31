package com.foodrecord.controller.user;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.RequireRole;
import com.foodrecord.model.dto.FoodRecommendationDTO;
import com.foodrecord.model.entity.Food;
import com.foodrecord.model.entity.FoodRecommendation;
import com.foodrecord.service.impl.FoodRecommendationServiceImpl;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;
import java.util.List;

@RestController
@RequestMapping("/api/recommendations")
@Api(tags = "食品推荐模块")
public class FoodRecommendationController {
    private final FoodRecommendationServiceImpl recommendationService;

    public FoodRecommendationController(FoodRecommendationServiceImpl recommendationService) {
        this.recommendationService = recommendationService;
    }

    @GetMapping("/user/{userId}")
    @ApiOperation("根据userId获取食品推荐")
    public ApiResponse<IPage<FoodRecommendation>> getPageByUserId(
            @PathVariable Long userId,
            @RequestParam(required = false) String type,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int size) {
        return ApiResponse.success(recommendationService.getPageByUserId(userId, type, page, size));
    }

    @GetMapping("/user/{userId}/top")
    @ApiOperation("获取前n条食品推荐")
    public ApiResponse<List<FoodRecommendation>> getTopRecommendations(
            @PathVariable Long userId,
            @RequestParam String type,
            @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(recommendationService.getTopRecommendations(userId, type, limit));
    }

    @PostMapping
    @ApiOperation("创建食品推荐")
    public ApiResponse<FoodRecommendation> createOrUpdate(@Valid @RequestBody FoodRecommendationDTO dto) {
        return ApiResponse.success(recommendationService.createOrUpdate(dto));
    }

    @PostMapping("/user/{userId}/health-goal")
    @ApiOperation("获取食品推荐建议")
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