package com.foodrecord.controller.admin;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.RequireRole;
import com.foodrecord.model.dto.FoodDTO;
import com.foodrecord.model.entity.Food;
import com.foodrecord.service.FoodService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.web.bind.annotation.*;
import javax.annotation.Resource;
import javax.validation.Valid;
import java.util.HashMap;
import java.util.List;
import java.util.Map;


@RestController
@RequestMapping("/api/admin/foods")
@Api(tags = "管理食品模块")
public class AdminFoodController {

    @Resource
    private FoodService foodService;

    /**
     * 分页获取食品列表
     *
     * @param page 页码，默认值为 1
     * @param size 每页记录数，默认值为 10，最大值为 25
     * @param keyword 搜索关键字，可选，用于模糊查询食品名称或其他字段
     * @return 分页的食品记录
     */
    @GetMapping
    @ApiOperation(value = "分页获取食品列表", notes = "根据分页参数和可选的搜索关键字获取食品列表")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Page<Food>> getFoods(
            @ApiParam(value = "页码，从1开始", example = "1")
            @RequestParam(value = "page", defaultValue = "1") int page,

            @ApiParam(value = "每页记录数，最大值为25", example = "10")
            @RequestParam(value = "size", defaultValue = "10") int size,

            @ApiParam(value = "搜索关键字，可选", example = "苹果")
            @RequestParam(value = "keyword", required = false) String keyword) {
        if (size > 25) {
            throw new IllegalArgumentException("参数错误");
        }
        Page<Food> foodPage = foodService.getFoods(new Page<>(page, size), keyword);
        return ApiResponse.success(foodPage);
    }

    /**
     * 根据关键词搜索食品（不分页）
     *
     * @param keyword 搜索关键字
     * @return 符合条件的食品列表
     */
    @GetMapping("/search")
    @ApiOperation(value = "根据关键词搜索食品（不分页）", notes = "通过关键词搜索所有符合条件的食品记录")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<List<Food>> searchFoods(
            @ApiParam(value = "搜索关键字", example = "苹果", required = true)
            @RequestParam String keyword) {
        List<Food> foods = foodService.searchFoods(keyword);
        return ApiResponse.success(foods);
    }

    /**
     * 根据食品ID获取食品详情
     *
     * @param id 食品ID
     * @return 食品详情
     */
    @GetMapping("/{id}")
    @ApiOperation(value = "根据食品ID获取食品详情", notes = "通过食品ID获取食品的详细信息")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Food> getFoodById(
            @ApiParam(value = "食品ID", example = "1001", required = true)
            @PathVariable Long id) {
        Food food = foodService.getFoodById(id);
        return food != null ? ApiResponse.success(food) : ApiResponse.error(404, "食品不存在");
    }

    /**
     * 新增食品
     *
     * @param foodDTO 食品数据传输对象
     * @return 新创建的食品对象
     */
    @PostMapping
    @ApiOperation(value = "新增食品", notes = "新增一条食品记录，传入食品的相关数据")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Food> createFood(
            @ApiParam(value = "食品DTO对象", required = true)
            @Valid @RequestBody FoodDTO foodDTO) {
        Food newFood = foodService.createFood(foodDTO);
        return ApiResponse.success(newFood);
    }

    /**
     * 更新食品信息
     *
     * @param id 食品ID
     * @param foodDTO 食品数据传输对象
     * @return 更新后的食品对象
     */
    @PutMapping("/{id}")
    @ApiOperation(value = "更新食品信息", notes = "根据食品ID更新对应的食品信息")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Food> updateFood(
            @ApiParam(value = "食品ID", example = "1001", required = true)
            @PathVariable Long id,

            @ApiParam(value = "食品DTO对象", required = true)
            @Valid @RequestBody FoodDTO foodDTO) {
        Food updatedFood = foodService.updateFood(id, foodDTO);
        return updatedFood != null ? ApiResponse.success(updatedFood) : ApiResponse.error(404, "食品不存在");
    }

    /**
     * 删除食品
     *
     * @param id 食品ID
     * @return 删除成功或错误信息
     */
    @DeleteMapping("/{id}")
    @ApiOperation(value = "删除食品", notes = "根据食品ID删除对应的食品记录")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<String> deleteFood(
            @ApiParam(value = "食品ID", example = "1001", required = true)
            @PathVariable Long id) {
        boolean deleted = foodService.deleteFoodById(id);
        return deleted ? ApiResponse.success("删除成功") : ApiResponse.error(404, "食品不存在或已删除");
    }

    /**
     * 批量删除食品
     *
     * @param foodIds 要删除的食品ID列表
     * @return 批量删除结果
     */
    @DeleteMapping
    @ApiOperation(value = "批量删除食品", notes = "根据食品ID列表批量删除食品")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<String> batchDeleteFoods(
            @ApiParam(value = "食品ID列表", required = true, example = "[1001, 1002, 1003]")
            @RequestBody List<Long> foodIds) {
        foodService.batchDeleteFoods(foodIds);
        return ApiResponse.success("批量删除成功");
    }

    /**
     * 切换食品的上下架状态
     *
     * @param id 食品ID
     * @return 更新后的食品对象
     */
    @PutMapping("/{id}/toggle-status")
    @ApiOperation(value = "切换食品的上下架状态", notes = "根据食品ID切换其上下架状态")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Food> toggleFoodStatus(
            @ApiParam(value = "食品ID", example = "1001", required = true)
            @PathVariable Long id) {
        Food updatedFood = foodService.toggleFoodStatus(id);
        return updatedFood != null ? ApiResponse.success(updatedFood) : ApiResponse.error(404, "食品不存在");
    }

    @GetMapping("/analytics")
    @ApiOperation("食品数据分析")
    public ApiResponse<Map<String, Object>> getAnalytics() {
        Map<String, Object> analytics = new HashMap<>();
        try {
            List<Map<String, Object>> maps = foodService.selectCountByField("health_light");
            analytics.put("health_light", maps);
            List<Map<String, Object>> maps1 = foodService.selectCountByField("is_available");
            analytics.put("is_available", maps1);
            List<Map<String, Object>> maps2 = foodService.selectCountByField("health_label");
            analytics.put("health_label", maps2);
            List<Map<String, Object>> maps3 = foodService.selectCountByField("is_liquid");
            analytics.put("is_liquid", maps3);
            return ApiResponse.success(analytics);
        }catch (Exception e) {
            e.printStackTrace();
        }
        return null;
    }
}