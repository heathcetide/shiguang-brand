package com.foodrecord.controller.user;

import cn.hutool.core.io.resource.ClassPathResource;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.AuthContext;
import com.foodrecord.common.auth.RequireRole;
import com.foodrecord.model.dto.FoodDTO;
import com.foodrecord.model.entity.Food;
import com.foodrecord.model.entity.user.User;
import com.foodrecord.service.FoodService;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.service.RecommenderService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.data.domain.Pageable;
import org.springframework.web.bind.annotation.*;

import javax.annotation.PostConstruct;
import javax.annotation.Resource;
import javax.validation.Valid;
import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/foods")
@Api(tags = "用户食品模块")
public class FoodController {
    @Resource
    private FoodService foodService;

    @Resource
    private RecommenderService recommenderService;

    @PostMapping("/admin/train")
    @ApiOperation("手动训练模型(管理员)")
    public ApiResponse<String> initializeAndTrainModel() {
        ClassPathResource classPathResource = new ClassPathResource("models/food_recommend_model.zip");
        File file = classPathResource.getFile();
        String absoluteFIlePath = file.getAbsolutePath();
        System.out.println("开始训练模型");
        recommenderService.trainModel();
        recommenderService.saveModel(absoluteFIlePath);
        // 加载模型
        recommenderService.loadModel(absoluteFIlePath);
        return ApiResponse.success("模型重新构建完成");
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
        ClassPathResource classPathResource = new ClassPathResource("models/food_recommend_model.zip");
        File file = classPathResource.getFile();
        String absoluteFIlePath = file.getAbsolutePath();
        recommenderService.loadModel(absoluteFIlePath);
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
     * 预测单个食物的评分
     */
    public void predictSingleFoodRating() {
        Long userId = 1L;  // 用户 ID
        Long foodId = 101L;  // 食物 ID

        double rating = recommenderService.predictRating(userId, foodId);
        System.out.println("用户 " + userId + " 对食物 " + foodId + " 的预测评分：" + rating);
    }

    @GetMapping("/recommend")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    @ApiOperation(value = "机器学习推荐食物功能", notes = "可以根据机器学习算法，进行用户的匹配食物推荐，输入需要推荐几条数据即可")
    public ApiResponse<List<Food>> recommendForUser(
            @ApiParam(value = "获取推荐数量", example = "5")
            @RequestParam int numRecommendations) {
        User currentUser = AuthContext.getCurrentUser();
        List<Food> foodArrayList = new ArrayList<>();
        List<Long> longs = recommenderService.recommendForUser(currentUser.getId(), numRecommendations);
        for (Long long1 : longs) {
            foodArrayList.add(foodService.findById(long1));
        }
        return ApiResponse.success(foodArrayList);
    }

    @GetMapping("/predict")
    @ApiOperation("机器学习预测测试(无需对接)")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<Map<String, Double>> predictRating(
            @ApiParam(value = "", example = "")
            @RequestParam Long userId, @RequestParam Long foodId) {
        Map<String, Double> map = new HashMap<>();
        map.put("degree", recommenderService.predictRating(userId, foodId));
        return ApiResponse.success(map);
    }


    @GetMapping
    @ApiOperation("获取食物")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<Page<Food>> getAllFoods(Pageable pageable) {
        return ApiResponse.success(foodService.getAllFoods(pageable));
    }

    @GetMapping("/{id}")
    @ApiOperation("根据id获取食物")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<Food> getFoodById(@PathVariable Long id) {
        return ApiResponse.success(foodService.getFoodById(id));
    }

    @GetMapping("/search")
    @ApiOperation("根据菜名获取食品")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<List<Food>> searchFoods(@RequestParam String name) {
        return ApiResponse.success(foodService.searchFoodsByName(name));
    }

    @PostMapping
    @ApiOperation("创建食品")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<Food> createFood(@Valid @RequestBody FoodDTO foodDTO) {
        return ApiResponse.success(foodService.createFood(foodDTO));
    }

    @PutMapping("/{id}")
    @ApiOperation("更新食品")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<Food> updateFood(@PathVariable Long id, @Valid @RequestBody FoodDTO foodDTO) {
        return ApiResponse.success(foodService.updateFood(id, foodDTO));
    }

    @DeleteMapping("/{id}")
    @ApiOperation("根据id删除食品")
    @RequireRole({"GUEST", "USER", "ADMIN", "SUPERADMIN", "VIP", "SVIP"})
    public ApiResponse<Void> deleteFood(@PathVariable Long id) {
        foodService.deleteFood(id);
        return ApiResponse.success(null);
    }
} 