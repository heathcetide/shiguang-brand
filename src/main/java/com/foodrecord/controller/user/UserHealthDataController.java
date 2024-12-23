package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.utils.JwtUtils;
import com.foodrecord.model.dto.UserHealthDataDTO;
import com.foodrecord.model.entity.user.UserHealthData;
import com.foodrecord.model.vo.UserHealthDataVO;
import com.foodrecord.service.UserHealthDataService;
import com.foodrecord.service.impl.UserHealthDataServiceImpl;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/health-data")
@Api(tags = "健康数据模块")
public class UserHealthDataController {

    @Autowired
    private UserHealthDataService healthDataService;

    @Autowired
    private JwtUtils jwtUtils;

    public UserHealthDataController(UserHealthDataServiceImpl healthDataService) {
        this.healthDataService = healthDataService;
    }

    /**
     * 获取用户的健康数据
     * @param userId 用户ID
     * @return 用户健康数据
     */
    @GetMapping("/user/{userId}")
    @ApiOperation("获取用户的健康数据")
    public ApiResponse<UserHealthData> getUserHealthData(@PathVariable Long userId) {
        return ApiResponse.success(healthDataService.getUserHealthData(userId));
    }

    /**
     * 创建用户的健康数据
     * @param healthDataDTO 健康数据信息
     * @return 创建成功的健康数据
     */
    @PostMapping("/add")
    @ApiOperation("创建用户的健康数据")
    public ApiResponse<UserHealthData> createUserHealthData(
            @RequestHeader("Authorization") String token,
            @RequestBody UserHealthDataDTO healthDataDTO) {
        try {
            Long userIdFromToken = jwtUtils.getUserIdFromToken(token);
            UserHealthData userHealthData = healthDataService.createUserHealthData(userIdFromToken, healthDataDTO);
            return ApiResponse.success(userHealthData);
        }catch (Exception e) {
            e.printStackTrace();
        }
        return ApiResponse.error(300,"操作失败");
    }

    /**
     * 更新用户的健康数据
     * @param healthDataDTO 更新的健康数据信息
     * @return 更新后的健康数据
     */
    @PutMapping("/update")
    @ApiOperation("更新用户的健康数据")
    public ApiResponse<UserHealthDataVO> updateUserHealthData(
            @RequestHeader("Authorization") String token,
            @RequestBody UserHealthDataDTO healthDataDTO) {
        Long userIdFromToken = jwtUtils.getUserIdFromToken(token);
        UserHealthData userHealthData = healthDataService.updateUserHealthData(userIdFromToken, healthDataDTO);
        return ApiResponse.success(new UserHealthDataVO().convertToVO(userHealthData));
    }
} 