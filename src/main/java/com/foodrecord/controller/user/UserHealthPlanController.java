package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.entity.user.UserHealthPlan;
import com.foodrecord.service.UserHealthPlanService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.web.bind.annotation.*;
import javax.annotation.Resource;

/**
 * 用户健康计划模块的控制器类
 */
@RestController
@RequestMapping("/health-plan")
@Api(tags = "用户健康计划模块")  // 为 Swagger 文档指定标签，标识该控制器是用户健康计划相关的 API
public class UserHealthPlanController {

    @Resource
    private UserHealthPlanService userHealthPlanService;

    /**
     * 创建新的用户健康计划
     *
     * @param plan 用户健康计划对象，包含用户的健康计划数据
     * @return 返回创建后的健康计划对象
     */
    @PostMapping("/create")
    @ApiOperation(value = "创建健康计划", notes = "提供健康计划数据并创建新的健康计划") // Swagger 操作说明
    public ApiResponse<UserHealthPlan> createHealthPlan(
            @ApiParam(value = "用户健康计划对象", required = true) @RequestBody UserHealthPlan plan) {
        // 调用服务层方法创建健康计划
        return ApiResponse.success(userHealthPlanService.createHealthPlan(plan));
    }

    /**
     * 更新现有的用户健康计划
     *
     * @param plan 更新后的健康计划对象
     * @return 返回更新后的健康计划对象
     */
    @PutMapping("/update")
    @ApiOperation(value = "更新健康计划", notes = "提供健康计划数据并更新现有健康计划") // Swagger 操作说明
    public ApiResponse<UserHealthPlan> updateHealthPlan(
            @ApiParam(value = "更新后的用户健康计划对象", required = true) @RequestBody UserHealthPlan plan) {
        // 调用服务层方法更新健康计划
        return ApiResponse.success(userHealthPlanService.updateHealthPlan(plan));
    }

    /**
     * 删除指定的用户健康计划
     *
     * @param id 健康计划的唯一标识符
     * @return 返回删除操作的结果
     */
    @DeleteMapping("/delete/{id}")
    @ApiOperation(value = "删除健康计划", notes = "根据健康计划的 ID 删除对应的健康计划") // Swagger 操作说明
    public ApiResponse<Boolean> deleteHealthPlan(
            @ApiParam(value = "健康计划的 ID", required = true) @PathVariable Long id) {
        // 调用服务层方法删除健康计划
        userHealthPlanService.deleteHealthPlan(id);
        return ApiResponse.success(true);
    }

    /**
     * 获取指定 ID 的用户健康计划
     *
     * @param id 健康计划的唯一标识符
     * @return 返回查询到的健康计划对象
     */
    @GetMapping("/get/{id}")
    @ApiOperation(value = "获取健康计划", notes = "根据健康计划的 ID 获取对应的健康计划详情") // Swagger 操作说明
    public ApiResponse<UserHealthPlan> getHealthPlanById(
            @ApiParam(value = "健康计划的 ID", required = true) @PathVariable Long id) {
        // 调用服务层方法根据 ID 获取健康计划
        return ApiResponse.success(userHealthPlanService.getHealthPlanById(id));
    }
}
