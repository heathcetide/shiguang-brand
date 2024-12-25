package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.FoodDTO;
import com.foodrecord.model.entity.Food;
import com.foodrecord.service.FoodService;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.service.RecommenderService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.data.domain.Pageable;
import org.springframework.web.bind.annotation.*;

import javax.annotation.PostConstruct;
import javax.annotation.Resource;
import javax.validation.Valid;
import java.util.ArrayList;
import java.util.List;

@RestController
@RequestMapping("/api/foods")
@Api(tags = "用户食品模块")
public class FoodController {
    @Resource
    private FoodService foodService;

    @Resource
    private RecommenderService recommenderService;

//    @PostConstruct
    public void initializeAndTrainModel() {
        System.out.println("开始训练模型");
        recommenderService.trainModel();
        recommenderService.saveModel("path_to_save_model.zip");
        // 加载模型
        recommenderService.loadModel("model_path.zip");
        System.out.println("模型加载完成！");
        /**
         *         // 加载模型
         *         recommenderService.loadModel("model_path.zip");
         *         System.out.println("模型加载完成！");
         */
    }

    /**
     * 在重新启动系统时，可以加载之前保存的模型，而不需要重新训练：
     */
    @PostConstruct
    public void loadExistingModel() {
        String modelPath = "C:\\Users\\Lenovo\\Documents\\GitHub\\shiguang-brand\\path_to_save_model.zip";  // 之前保存的模型路径
        recommenderService.loadModel(modelPath);
        System.out.println("模型已加载！");
    }

    /**
     * 调用 recommendForUser 方法为用户生成推荐列表。
     */
    public void recommendFoodForUser() {
        Long userId = 1L;  // 假设用户 ID 为 1
        int numRecommendations = 5;  // 获取前 5 个推荐结果

        List<Long> recommendedFoodIds = recommenderService.recommendForUser(userId, numRecommendations);
        System.out.println("推荐的食物ID列表：" + recommendedFoodIds);
    }

    /**
     *  预测单个食物的评分
     */
    public void predictSingleFoodRating() {
        Long userId = 1L;  // 用户 ID
        Long foodId = 101L;  // 食物 ID

        double rating = recommenderService.predictRating(userId, foodId);
        System.out.println("用户 " + userId + " 对食物 " + foodId + " 的预测评分：" + rating);
    }

    @GetMapping("/recommend/{userId}")
    public ApiResponse<List<Food>> recommendForUser(@PathVariable Long userId, @RequestParam int numRecommendations) {
        List<Food> foodArrayList = new ArrayList<>();
        List<Long> longs = recommenderService.recommendForUser(userId, numRecommendations);
        for (Long long1 : longs) {
            foodArrayList.add(foodService.findById(long1));
        }
        return ApiResponse.success(foodArrayList);
    }

    @GetMapping("/predict")
    public double predictRating(@RequestParam Long userId, @RequestParam Long foodId) {
        return recommenderService.predictRating(userId, foodId);
    }


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