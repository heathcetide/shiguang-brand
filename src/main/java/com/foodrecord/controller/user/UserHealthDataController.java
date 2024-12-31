package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.AuthContext;
import com.foodrecord.common.auth.RequireRole;
import com.foodrecord.common.utils.JwtUtils;
import com.foodrecord.model.dto.UserHealthDataDTO;
import com.foodrecord.model.entity.Food;
import com.foodrecord.model.entity.user.UserHealthData;
import com.foodrecord.model.vo.UserHealthDataVO;
import com.foodrecord.service.FoodService;
import com.foodrecord.service.UserHealthDataService;
import com.foodrecord.service.impl.UserHealthDataServiceImpl;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.util.List;
import java.util.Map;

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

    @Resource
    private FoodService foodService;
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

    @GetMapping("/foods/health-based")
    @ApiOperation("基于健康状况的食品推荐")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Food>> getHealthBasedRecommendations(
            @RequestParam(required = false) String healthCondition) {
        // 根据用户的血压、血糖、胆固醇等健康指标推荐合适的食品
        return ApiResponse.success(foodService.getHealthBasedRecommendations(
                AuthContext.getCurrentUser().getId()));
    }

    @GetMapping("/foods/bmi-advice")
    @ApiOperation("基于BMI的饮食建议")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> getBMIBasedAdvice() {
        // 根据用户的BMI指数提供饮食建议和食品推荐
        return ApiResponse.success(foodService.getBMIBasedAdvice(
                AuthContext.getCurrentUser().getId()));
    }

    @GetMapping("/foods/activity-based")
    @ApiOperation("基于活动水平的营养建议")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> getActivityBasedAdvice() {
        // 根据用户的活动水平推荐适合的食品和营养摄入
        return ApiResponse.success(foodService.getActivityBasedAdvice(
                AuthContext.getCurrentUser().getId()));
    }

    @GetMapping("/foods/daily-menu")
    @ApiOperation("获取个性化每日食谱")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, List<Food>>> getPersonalizedDailyMenu() {
        // 根据用户的健康数据、活动水平和卡路里目标生成食谱
        return ApiResponse.success(foodService.getPersonalizedDailyMenu(
                AuthContext.getCurrentUser().getId()));
    }

    @GetMapping("/foods/goal-oriented")
    @ApiOperation("基于健康目标的食品推荐")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<List<Map<String, Object>>> getGoalOrientedRecommendations(
            @RequestParam String healthGoal) {  // weight-loss/muscle-gain/blood-sugar-control等
        return ApiResponse.success(foodService.getGoalOrientedRecommendations(
                AuthContext.getCurrentUser().getId(), healthGoal));
    }

    @GetMapping("/foods/health-condition")
    @ApiOperation("特殊健康状况的饮食建议")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> getHealthConditionAdvice(
            @RequestParam String condition) {  // high-blood-pressure/diabetes等
        return ApiResponse.success(foodService.getHealthConditionAdvice(
                AuthContext.getCurrentUser().getId(), condition));
    }

    @GetMapping("/foods/nutrition-balance")
    @ApiOperation("获取营养均衡评估")
    @RequireRole({"USER", "ADMIN"})
    public ApiResponse<Map<String, Object>> getNutritionBalanceAssessment() {
        // 分析用户的饮食习惯和营养摄入是否均衡
        return ApiResponse.success(foodService.getNutritionBalanceAssessment(
                AuthContext.getCurrentUser().getId()));
    }
} 