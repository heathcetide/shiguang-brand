package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.utils.JwtUtils;
import com.foodrecord.manager.AIPlanService;
import com.foodrecord.model.dto.UserDietaryGoalsDTO;
import com.foodrecord.model.entity.User;
import com.foodrecord.model.entity.UserDietaryGoals;
import com.foodrecord.model.entity.UserHealthData;
import com.foodrecord.model.entity.plan.AIPlanResponse;
import com.foodrecord.model.entity.plan.UserPlanInput;
import com.foodrecord.model.vo.UserDietaryGoalsVO;
import com.foodrecord.service.UserDietaryGoalsService;
import com.foodrecord.service.UserHealthDataService;
import com.foodrecord.service.UserHealthPlanService;
import com.foodrecord.service.UserService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.web.bind.annotation.*;
import javax.annotation.Resource;
import javax.validation.Valid;

@RestController
@RequestMapping("/api/dietary-goals")
@Api(tags = "用户饮食目标模块")
public class UserDietaryGoalsController {

    @Resource
    @Qualifier("foodUserService")
    private UserService userService;

    @Resource
    private UserHealthPlanService userHealthPlanService;

    @Resource
    private JwtUtils jwtUtils;

    @Resource
    private UserHealthDataService userHealthDataService;

    @Resource
    private UserDietaryGoalsService userDietaryGoalsService;

    /**
     * 获取用户饮食目标
     *
     * @param token 授权令牌
     * @return 包含用户饮食目标的ApiResponse对象
     */
    @GetMapping("/get")
    @ApiOperation(value = "获取用户饮食目标")
    public ApiResponse<UserDietaryGoalsVO> getByUserId(@RequestHeader("Authorization") String token) {
        Long userIdFromToken = jwtUtils.getUserIdFromToken(token);
        try {
            User userByUsername = userService.getUserById(userIdFromToken);
            if (userByUsername == null) {
                return ApiResponse.error(400, "找不到此用户");
            }
            if (userByUsername.getStatus() == 2) {
                return ApiResponse.error(401, "无权限访问");
            }
            UserDietaryGoals byUserId = userDietaryGoalsService.getByUserId(userByUsername.getId());
            if (byUserId == null) {
                return ApiResponse.error(400,"该用户这段时间没有设置目标");
            }
            return ApiResponse.success(new UserDietaryGoalsVO().toUserDietaryGoalsVO(byUserId));
        }catch (Exception e){
            e.printStackTrace();
        }
        return ApiResponse.error(300,"操作失败");
    }

    /**
     * 为用户生成健康计划
     *
     * @param token 授权令牌
     * @return 包含生成结果的ApiResponse对象
     */
    @PostMapping("/generate")
    @ApiOperation(value = "为用户生成健康计划")
    public ApiResponse<String> generateHealthPlan(
            @RequestHeader("Authorization") String token) {
        try {
            // Step 1: 从 Token 获取用户 ID
            Long userIdFromToken = jwtUtils.getUserIdFromToken(token);

            // Step 2: 验证用户信息
            User user = userService.getUserById(userIdFromToken);
            if (user == null) {
                return ApiResponse.error(400, "用户不存在");
            }
            if (user.getStatus() != 1) {
                return ApiResponse.error(403, "无权限操作");
            }

            // Step 3: 聚合用户健康数据
            UserHealthData healthData = userHealthDataService.getUserHealthData(userIdFromToken);
            if (healthData == null) {
                return ApiResponse.error(400, "缺少用户健康数据");
            }

            // Step 4: 获取用户饮食目标
            UserDietaryGoals dietaryGoals = userDietaryGoalsService.getByUserId(userIdFromToken);
            if (dietaryGoals == null) {
                return ApiResponse.error(400, "缺少用户饮食目标");
            }

            // Step 5: 校验目标时间范围是否合理
            if (dietaryGoals.getStartDate() == null || dietaryGoals.getEndDate() == null) {
                return ApiResponse.error(400, "饮食目标未设置有效时间范围");
            }
            if (dietaryGoals.getEndDate().before(dietaryGoals.getStartDate())) {
                return ApiResponse.error(400, "饮食目标的结束日期不能早于开始日期");
            }

            // Step 6: 构建用户信息输入（生成用户信息预设）
            UserPlanInput input = new UserPlanInput(user, healthData, dietaryGoals);

            // Step 7: 调用 AI 服务生成计划
            AIPlanResponse aiPlanResponse = AIPlanService.generatePlan(input);
            if (aiPlanResponse == null || aiPlanResponse.getDailyPlans().isEmpty()) {
                return ApiResponse.error(500, "AI 计划生成失败，请稍后再试");
            }

            // Step 8: 保存生成的计划到数据库
            userHealthPlanService.saveGeneratedPlans(userIdFromToken, dietaryGoals.getId(), aiPlanResponse);

            return ApiResponse.success("健康计划生成成功");

        } catch (Exception e) {
            e.printStackTrace();
            return ApiResponse.error(500, "服务器内部错误：" + e.getMessage());
        }
    }

    /**
     * 创建或更新用户饮食目标
     *
     * @param userId 用户ID
     * @param dto    用户饮食目标DTO
     * @return 包含创建或更新结果的ApiResponse对象
     */
    @PostMapping("/user/{userId}")
    @ApiOperation(value = "创建或更新用户饮食目标")
    public ApiResponse<UserDietaryGoals> createOrUpdate(
            @ApiParam(value = "用户ID", required = true) @PathVariable Long userId,
            @ApiParam(value = "用户饮食目标DTO", required = true) @Valid @RequestBody UserDietaryGoalsDTO dto) {
        return ApiResponse.success(userDietaryGoalsService.createOrUpdate(userId, dto));
    }
} 