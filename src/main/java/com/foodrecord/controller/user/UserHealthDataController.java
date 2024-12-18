package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.UserHealthDataDTO;
import com.foodrecord.model.entity.UserHealthData;
import com.foodrecord.service.impl.UserHealthDataServiceImpl;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;

@RestController
@RequestMapping("/api/health-data")
public class UserHealthDataController {
    private final UserHealthDataServiceImpl healthDataService;

    public UserHealthDataController(UserHealthDataServiceImpl healthDataService) {
        this.healthDataService = healthDataService;
    }

    /**
     * 获取用户的健康数据
     * @param userId 用户ID
     * @return 用户健康数据
     */
    @GetMapping("/user/{userId}")
    public ApiResponse<UserHealthData> getUserHealthData(@PathVariable Long userId) {
        return ApiResponse.success(healthDataService.getUserHealthData(userId));
    }

    /**
     * 创建用户的健康数据
     * @param userId 用户ID
     * @param healthDataDTO 健康数据信息
     * @return 创建成功的健康数据
     */
    @PostMapping("/user/{userId}")
    public ApiResponse<UserHealthData> createUserHealthData(
            @PathVariable Long userId,
            @Valid @RequestBody UserHealthDataDTO healthDataDTO) {
        return ApiResponse.success(healthDataService.createUserHealthData(userId, healthDataDTO));
    }

    /**
     * 更新用户的健康数据
     * @param userId 用户ID
     * @param healthDataDTO 更新的健康数据信息
     * @return 更新后的健康数据
     */
    @PutMapping("/user/{userId}")
    public ApiResponse<UserHealthData> updateUserHealthData(
            @PathVariable Long userId,
            @Valid @RequestBody UserHealthDataDTO healthDataDTO) {
        return ApiResponse.success(healthDataService.updateUserHealthData(userId, healthDataDTO));
    }
} 