package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.RequireRole;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/food/nutrition")
@Api(tags = "食品营养分析模块")
public class FoodNutritionController {

    @GetMapping("/score/{foodId}")
    @ApiOperation("获取食品营养评分")
    @RequireRole({"GUEST", "USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> getNutritionScore(@PathVariable Long foodId) {
        return null; // TODO
    }

    @GetMapping("/compare")
    @ApiOperation("营养成分对比")
    @RequireRole({"GUEST", "USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> compareNutrition(
            @RequestParam List<Long> foodIds) {
        return null; // TODO
    }

    @GetMapping("/daily-intake")
    @ApiOperation("获取每日营养摄入统计")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> getDailyIntake() {
        return null; // TODO
    }
} 