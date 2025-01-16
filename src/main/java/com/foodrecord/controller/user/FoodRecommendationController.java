package com.foodrecord.controller.user;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.RequireRole;
import com.foodrecord.model.dto.FoodRecommendationDTO;
import com.foodrecord.model.entity.Food;
import com.foodrecord.model.entity.FoodRecommendation;
import com.foodrecord.service.FoodRecommendationService;
import com.foodrecord.service.impl.FoodRecommendationServiceImpl;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiImplicitParam;
import io.swagger.annotations.ApiImplicitParams;
import io.swagger.annotations.ApiOperation;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.validation.Valid;
import java.util.List;

@RestController
@RequestMapping("/api/recommendations")
@Api(tags = "食品推荐模块")
public class FoodRecommendationController {

    @Resource
    private FoodRecommendationService recommendationService;

    /**
     * 根据用户ID获取食品推荐
     *
     * @param userId 用户ID
     * @param type 推荐类型（可选）
     * @param page 页码，默认为1
     * @param size 每页大小，默认为10
     * @return 包含食品推荐分页结果的ApiResponse对象
     */
    @GetMapping("/user/{userId}")
    @ApiOperation("根据用户ID获取食品推荐")
    @ApiImplicitParams({
            @ApiImplicitParam(name = "userId", value = "用户ID", required = true, dataType = "Long", paramType = "path"),
            @ApiImplicitParam(name = "type", value = "推荐类型", required = false, dataType = "String", paramType = "query"),
            @ApiImplicitParam(name = "page", value = "页码", defaultValue = "1", dataType = "int", paramType = "query"),
            @ApiImplicitParam(name = "size", value = "每页大小", defaultValue = "10", dataType = "int", paramType = "query")
    })
    public ApiResponse<IPage<FoodRecommendation>> getPageByUserId(
            @PathVariable Long userId,
            @RequestParam(required = false) String type,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int size) {
        return ApiResponse.success(recommendationService.getPageByUserId(userId, type, page, size));
    }
    /**
     * 获取前n条食品推荐
     *
     * @param userId 用户ID
     * @param type 推荐类型
     * @param limit 返回的数量，默认为10
     * @return 包含前n条食品推荐的ApiResponse对象
     */
    @GetMapping("/user/{userId}/top")
    @ApiOperation("获取前n条食品推荐")
    @ApiImplicitParams({
            @ApiImplicitParam(name = "userId", value = "用户ID", required = true, dataType = "Long", paramType = "path"),
            @ApiImplicitParam(name = "type", value = "推荐类型", required = true, dataType = "String", paramType = "query"),
            @ApiImplicitParam(name = "limit", value = "返回的数量", defaultValue = "10", dataType = "int", paramType = "query")
    })
    public ApiResponse<List<FoodRecommendation>> getTopRecommendations(
            @PathVariable Long userId,
            @RequestParam String type,
            @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(recommendationService.getTopRecommendations(userId, type, limit));
    }

    /**
     * 创建或更新食品推荐
     *
     * @param dto 食品推荐DTO
     * @return 包含创建或更新后的食品推荐信息的ApiResponse对象
     */
    @PostMapping
    @ApiOperation("创建或更新食品推荐")
    @ApiImplicitParam(name = "dto", value = "食品推荐DTO", required = true, dataType = "FoodRecommendationDTO", paramType = "body")
    public ApiResponse<FoodRecommendation> createOrUpdate(@RequestBody FoodRecommendationDTO dto) {
        return ApiResponse.success(recommendationService.createOrUpdate(dto));
    }

    /**
     * 获取健康目标食品推荐建议
     *
     * @param userId 用户ID
     * @return 处理结果信息
     */
    @PostMapping("/user/{userId}/health-goal")
    @ApiOperation("获取健康目标食品推荐建议")
    @ApiImplicitParam(name = "userId", value = "用户ID", required = true, dataType = "Long", paramType = "path")
    public ApiResponse<Boolean> generateHealthGoalRecommendations(@PathVariable Long userId) {
        recommendationService.generateHealthGoalRecommendations(userId);
        return ApiResponse.success(true);
    }

    /**
     * 获取营养平衡食品推荐建议
     *
     * @param userId 用户ID
     * @return 处理结果信息
     */
    @PostMapping("/user/{userId}/nutrition-balance")
    @ApiOperation("获取营养平衡食品推荐建议")
    @ApiImplicitParam(name = "userId", value = "用户ID", required = true, dataType = "Long", paramType = "path")
    public ApiResponse<Boolean> generateNutritionBalanceRecommendations(@PathVariable Long userId) {
        recommendationService.generateNutritionBalanceRecommendations(userId);
        return ApiResponse.success(true);
    }
} 