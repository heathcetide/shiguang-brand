package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.NutritionDTO;
import com.foodrecord.model.entity.Nutrition;
import com.foodrecord.service.NutritionService;
import com.foodrecord.service.impl.NutritionServiceImpl;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiImplicitParam;
import io.swagger.annotations.ApiImplicitParams;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.validation.Valid;

@RestController
@RequestMapping("/api/nutrition")
@Api(tags = "营养物质模块[不重要]")
public class NutritionController {

    @Resource
    private NutritionService nutritionService;

    /**
     * 根据食品ID获取营养信息
     *
     * @param foodId 食品ID
     * @return 包含营养信息的ApiResponse对象
     */
    @GetMapping("/food/{foodId}")
    @ApiOperation("根据食品ID获取营养信息")
    @ApiImplicitParam(name = "foodId", value = "食品ID", required = true, dataType = "Long", paramType = "path")
    public ApiResponse<Nutrition> getNutritionByFoodId(@PathVariable Long foodId) {
        return ApiResponse.success(nutritionService.getNutritionByFoodId(foodId));
    }

    /**
     * 创建新的营养信息
     *
     * @param nutritionDTO 营养信息DTO
     * @return 包含创建的营养信息的ApiResponse对象
     */
    @PostMapping
    @ApiOperation("创建新的营养信息")
    @ApiImplicitParam(name = "nutritionDTO", value = "营养信息DTO", required = true, dataType = "NutritionDTO", paramType = "body")
    public ApiResponse<Nutrition> createNutrition(@Valid @RequestBody NutritionDTO nutritionDTO) {
        return ApiResponse.success(nutritionService.createNutrition(nutritionDTO));
    }

    /**
     * 更新指定食品ID的营养信息
     *
     * @param foodId 食品ID
     * @param nutritionDTO 营养信息DTO
     * @return 包含更新后的营养信息的ApiResponse对象
     */
    @PutMapping("/food/{foodId}")
    @ApiOperation("更新指定食品ID的营养信息")
    @ApiImplicitParams({
            @ApiImplicitParam(name = "foodId", value = "食品ID", required = true, dataType = "Long", paramType = "path"),
            @ApiImplicitParam(name = "nutritionDTO", value = "营养信息DTO", required = true, dataType = "NutritionDTO", paramType = "body")
    })
    public ApiResponse<Nutrition> updateNutrition(
            @PathVariable Long foodId,
            @Valid @RequestBody NutritionDTO nutritionDTO) {
        return ApiResponse.success(nutritionService.updateNutrition(foodId, nutritionDTO));
    }
    /**
     * 删除指定食品ID的营养信息
     *
     * @param foodId 食品ID
     * @return 包含删除结果的ApiResponse对象
     */
    @DeleteMapping("/food/{foodId}")
    @ApiOperation("删除指定食品ID的营养信息")
    @ApiImplicitParam(name = "foodId", value = "食品ID", required = true, dataType = "Long", paramType = "path")
    public ApiResponse<Void> deleteNutrition(@PathVariable Long foodId) {
        nutritionService.deleteNutrition(foodId);
        return ApiResponse.success(null);
    }
} 