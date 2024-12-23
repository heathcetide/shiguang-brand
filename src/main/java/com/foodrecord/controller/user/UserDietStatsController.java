package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.entity.user.UserDietStats;
import com.foodrecord.service.impl.UserDietStatsServiceImpl;
import io.swagger.annotations.Api;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping("/api/diet-stats")
@Api(tags = "饮食统计模块")
public class UserDietStatsController {
    private final UserDietStatsServiceImpl statsService;

    public UserDietStatsController(UserDietStatsServiceImpl statsService) {
        this.statsService = statsService;
    }

    @GetMapping("/user/{userId}/daily")
    public ApiResponse<UserDietStats> getDailyStats(
            @PathVariable Long userId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return ApiResponse.success(statsService.getByUserIdAndDate(userId, date));
    }

    @GetMapping("/user/{userId}/range")
    public ApiResponse<List<UserDietStats>> getStatsRange(
            @PathVariable Long userId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate) {
        return ApiResponse.success(statsService.getByUserIdAndDateRange(userId, startDate, endDate));
    }

    @PostMapping("/user/{userId}/calculate")
    public ApiResponse<Boolean> calculateDailyStats(
            @PathVariable Long userId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        statsService.calculateDailyStats(userId, date);
        return ApiResponse.success(true);
    }

    @GetMapping("/top-achievers")
    public ApiResponse<List<UserDietStats>> getTopAchievers(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate,
            @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(statsService.getTopAchievers(startDate, endDate, limit));
    }
} 