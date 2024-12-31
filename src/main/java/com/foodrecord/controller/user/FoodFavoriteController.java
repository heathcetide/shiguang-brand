package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.RequireRole;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/food/favorites")
@Api(tags = "食品收藏模块")
public class FoodFavoriteController {

    @PostMapping("/{foodId}")
    @ApiOperation("收藏食品")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Boolean> addFavorite(@PathVariable Long foodId) {
        return null; // TODO
    }

    @DeleteMapping("/{foodId}")
    @ApiOperation("取消收藏")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Boolean> removeFavorite(@PathVariable Long foodId) {
        return null; // TODO
    }

    @GetMapping("/list")
    @ApiOperation("获取收藏列表")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getFavoriteList(
            @RequestParam(defaultValue = "1") Integer pageNum,
            @RequestParam(defaultValue = "10") Integer pageSize) {
        return null; // TODO
    }
} 