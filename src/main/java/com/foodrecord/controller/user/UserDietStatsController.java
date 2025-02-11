package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.entity.UserDietStats;
import com.foodrecord.service.UserDietStatsService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping("/api/diet-stats")
@Api(tags = "饮食统计模块")
public class UserDietStatsController {

    @Resource
    private UserDietStatsService statsService;

    /**
     * 获取用户每日饮食统计
     *
     * @param userId 用户ID
     * @param date   日期
     * @return 包含用户每日饮食统计的ApiResponse对象
     */
    @GetMapping("/user/{userId}/daily")
    @ApiOperation(value = "获取用户每日饮食统计")
    public ApiResponse<UserDietStats> getDailyStats(
            @ApiParam(value = "用户ID", required = true) @PathVariable Long userId,
            @ApiParam(value = "日期", required = true) @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return ApiResponse.success(statsService.getByUserIdAndDate(userId, date));
    }

    /**
     * 获取用户在指定日期范围内的饮食统计
     *
     * @param userId    用户ID
     * @param startDate 开始日期
     * @param endDate   结束日期
     * @return 包含用户在指定日期范围内的饮食统计列表的ApiResponse对象
     */
    @GetMapping("/user/{userId}/range")
    @ApiOperation(value = "获取用户在指定日期范围内的饮食统计")
    public ApiResponse<List<UserDietStats>> getStatsRange(
            @ApiParam(value = "用户ID", required = true) @PathVariable Long userId,
            @ApiParam(value = "开始日期", required = true) @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @ApiParam(value = "结束日期", required = true) @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate) {
        return ApiResponse.success(statsService.getByUserIdAndDateRange(userId, startDate, endDate));
    }

    /**
     * 计算用户每日饮食统计
     *
     * @param userId 用户ID
     * @param date   日期
     * @return 包含计算结果的ApiResponse对象
     */
    @PostMapping("/user/{userId}/calculate")
    @ApiOperation(value = "计算用户每日饮食统计")
    public ApiResponse<Boolean> calculateDailyStats(
            @ApiParam(value = "用户ID", required = true) @PathVariable Long userId,
            @ApiParam(value = "日期", required = true) @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        statsService.calculateDailyStats(userId, date);
        return ApiResponse.success(true);
    }

    /**
     * 获取指定日期范围内的饮食统计顶级成就者
     *
     * @param startDate 开始日期
     * @param endDate   结束日期
     * @param limit     返回结果的数量限制（默认10）
     * @return 包含顶级成就者饮食统计列表的ApiResponse对象
     */
    @GetMapping("/top-achievers")
    @ApiOperation(value = "获取指定日期范围内的饮食统计顶级成就者")
    public ApiResponse<List<UserDietStats>> getTopAchievers(
            @ApiParam(value = "开始日期", required = true) @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @ApiParam(value = "结束日期", required = true) @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate,
            @ApiParam(value = "返回结果的数量限制（默认10）", defaultValue = "10") @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(statsService.getTopAchievers(startDate, endDate, limit));
    }
} 