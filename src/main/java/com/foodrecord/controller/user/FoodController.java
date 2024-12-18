package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.FoodDTO;
import com.foodrecord.model.entity.Food;
import com.foodrecord.service.FoodService;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.validation.Valid;
import java.util.List;

@RestController
@RequestMapping("/api/foods")
public class FoodController {
    @Resource
    private FoodService foodService;

    @GetMapping
    public ApiResponse<Page<Food>> getAllFoods(Pageable pageable) {
        return ApiResponse.success(foodService.getAllFoods(pageable));
    }

    @GetMapping("/{id}")
    public ApiResponse<Food> getFoodById(@PathVariable Long id) {
        return ApiResponse.success(foodService.getFoodById(id));
    }

    @GetMapping("/search")
    public ApiResponse<List<Food>> searchFoods(@RequestParam String name) {
        return ApiResponse.success(foodService.searchFoodsByName(name));
    }

    @PostMapping
    public ApiResponse<Food> createFood(@Valid @RequestBody FoodDTO foodDTO) {
        return ApiResponse.success(foodService.createFood(foodDTO));
    }

    @PutMapping("/{id}")
    public ApiResponse<Food> updateFood(@PathVariable Long id, @Valid @RequestBody FoodDTO foodDTO) {
        return ApiResponse.success(foodService.updateFood(id, foodDTO));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> deleteFood(@PathVariable Long id) {
        foodService.deleteFood(id);
        return ApiResponse.success(null);
    }
} 