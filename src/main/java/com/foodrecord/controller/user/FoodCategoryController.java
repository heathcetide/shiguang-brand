package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.RequireRole;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/food/categories")
@Api(tags = "食品分类模块")
public class FoodCategoryController {

    @GetMapping("/list")
    @ApiOperation("获取食品分类列表")
    @RequireRole({"GUEST", "USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getCategoryList() {
        return null; // TODO
    }

    @GetMapping("/stats")
    @ApiOperation("获取分类统计信息")
    @RequireRole({"GUEST", "USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> getCategoryStats() {
        return null; // TODO
    }

    @GetMapping("/{categoryId}/foods")
    @ApiOperation("获取分类下的食品列表")
    @RequireRole({"GUEST", "USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getFoodsByCategory(
            @PathVariable Long categoryId,
            @RequestParam(defaultValue = "1") Integer pageNum,
            @RequestParam(defaultValue = "10") Integer pageSize) {
        return null; // TODO
    }
} 