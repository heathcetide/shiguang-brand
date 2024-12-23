package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.FoodDTO;
import com.foodrecord.model.entity.Food;
import com.foodrecord.service.FoodService;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.data.domain.Pageable;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.validation.Valid;
import java.util.List;

@RestController
@RequestMapping("/api/foods")
@Api(tags = "用户食品模块")
public class FoodController {
    @Resource
    private FoodService foodService;

    @GetMapping
    @ApiOperation("获取食物")
    public ApiResponse<Page<Food>> getAllFoods(Pageable pageable) {
        return ApiResponse.success(foodService.getAllFoods(pageable));
    }

    @GetMapping("/{id}")
    @ApiOperation("根据id获取食物")
    public ApiResponse<Food> getFoodById(@PathVariable Long id) {
        return ApiResponse.success(foodService.getFoodById(id));
    }

    @GetMapping("/search")
    @ApiOperation("根据菜名获取食品")
    public ApiResponse<List<Food>> searchFoods(@RequestParam String name) {
        return ApiResponse.success(foodService.searchFoodsByName(name));
    }

    @PostMapping
    @ApiOperation("创建食品")
    public ApiResponse<Food> createFood(@Valid @RequestBody FoodDTO foodDTO) {
        return ApiResponse.success(foodService.createFood(foodDTO));
    }

    @PutMapping("/{id}")
    @ApiOperation("更新食品")
    public ApiResponse<Food> updateFood(@PathVariable Long id, @Valid @RequestBody FoodDTO foodDTO) {
        return ApiResponse.success(foodService.updateFood(id, foodDTO));
    }

    @DeleteMapping("/{id}")
    @ApiOperation("根据id删除食品")
    public ApiResponse<Void> deleteFood(@PathVariable Long id) {
        foodService.deleteFood(id);
        return ApiResponse.success(null);
    }
} 