package com.foodrecord.controller.admin;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.RequireRole;
import com.foodrecord.model.entity.user.UserHealthPlan;
import com.foodrecord.service.UserHealthPlanService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;
import javax.annotation.Resource;
import java.util.List;
import java.util.Map;

/**
 * 管理员计划管理模块
 * 提供管理员对用户健康计划的管理功能，包括分页查询、按用户ID查询、批量删除、更新状态、统计信息等。
 */
@RestController
@RequestMapping("/admin/health-plan")
@Api(tags = "管理计划管理模块")
public class AdminHealthPlanController {

    @Resource
    private UserHealthPlanService userHealthPlanService;

    /**
     * 分页获取所有用户健康计划
     *
     * @param page    当前页码，默认值为1
     * @param size    每页数据大小，默认值为10
     * @param keyword 模糊查询关键字（可选，支持计划内容和其他字段模糊匹配）
     * @return 分页后的健康计划列表
     */
    @ApiOperation(value = "分页获取所有用户健康计划", notes = "管理员可以通过分页形式获取所有用户的健康计划，并支持通过关键字进行模糊查询")
    @GetMapping("/page/get")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<List<UserHealthPlan>> getAllHealthPlans(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int size,
            @RequestParam(required = false) String keyword
    ) {
        return ApiResponse.success(userHealthPlanService.getAllHealthPlans(page, size, keyword));
    }

    /**
     * 根据用户ID获取健康计划
     *
     * @param userId 用户ID
     * @return 指定用户的健康计划列表
     */
    @ApiOperation(value = "根据用户ID获取健康计划", notes = "管理员可以根据用户ID获取该用户的所有健康计划")
    @GetMapping("/user/{userId}")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<List<UserHealthPlan>> getHealthPlansByUserId(@PathVariable Long userId) {
        return ApiResponse.success(userHealthPlanService.getHealthPlansByUserId(userId));
    }

    /**
     * 批量删除健康计划
     *
     * @param planIds 健康计划ID列表
     * @return 删除操作是否成功
     */
    @ApiOperation(value = "批量删除健康计划", notes = "管理员可以批量删除多个用户的健康计划")
    @DeleteMapping("/delete/batch")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Boolean> batchDeleteHealthPlans(@RequestBody List<Long> planIds) {
        userHealthPlanService.batchDeleteHealthPlans(planIds);
        return ApiResponse.success(true);
    }

    /**
     * 更新健康计划状态
     *
     * @param planId 健康计划ID
     * @param status 新的计划状态（如：审核通过、拒绝等）
     * @return 更新操作是否成功
     */
    @ApiOperation(value = "更新健康计划状态", notes = "管理员可以更新指定健康计划的状态，例如：审核通过、拒绝等")
    @PutMapping("/update/status/{planId}")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Boolean> updatePlanStatus(@PathVariable Long planId, @RequestParam String status) {
        userHealthPlanService.updatePlanStatus(planId, status);
        return ApiResponse.success(true);
    }

    /**
     * 批量更新计划状态
     *
     * @param updates 包含计划ID及状态的更新列表
     * @return 更新操作是否成功
     */
    @ApiOperation(value = "批量更新健康计划状态", notes = "管理员可以批量更新健康计划状态")
    @PutMapping("/update/status/batch")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Boolean> batchUpdatePlanStatus(@RequestBody Map<Long, String> updates) {
        userHealthPlanService.batchUpdatePlanStatus(updates);
        return ApiResponse.success(true);
    }

    /**
     * 新增健康计划
     *
     * @param plan 健康计划实体类，包含计划内容、计划日期、计划类型等信息
     * @return 创建的健康计划对象
     */
    @ApiOperation(value = "新增健康计划", notes = "管理员可以新增健康计划并分配给特定用户")
    @PostMapping("/create")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<UserHealthPlan> createHealthPlan(@RequestBody UserHealthPlan plan) {
        return ApiResponse.success(userHealthPlanService.createHealthPlan(plan));
    }

    /**
     * 按分类获取健康计划
     *
     * @param category 分类名称（如“饮食”、“运动”）
     * @return 健康计划列表
     */
    @ApiOperation(value = "按分类获取健康计划", notes = "管理员可以按分类（如饮食、运动）查询健康计划")
    @GetMapping("/category")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<List<UserHealthPlan>> getPlansByCategory(@RequestParam String category) {
        return ApiResponse.success(userHealthPlanService.getPlansByCategory(category));
    }

    /**
     * 获取指定时间范围内的健康计划
     *
     * @param startDate 开始日期
     * @param endDate   结束日期
     * @return 健康计划列表
     */
    @ApiOperation(value = "获取指定时间范围内的健康计划", notes = "管理员可以按时间范围查询健康计划")
    @GetMapping("/date/range")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<List<UserHealthPlan>> getPlansByDateRange(
            @RequestParam String startDate, @RequestParam String endDate) {
        return ApiResponse.success(userHealthPlanService.getAllPlansByDateRange(startDate, endDate));
    }

    /**
     * 获取最新创建的健康计划
     *
     * @param limit 限制条数
     * @return 最新创建的健康计划列表
     */
    @ApiOperation(value = "获取最新创建的健康计划", notes = "管理员可以获取按创建时间倒序排列的健康计划")
    @GetMapping("/latest")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<List<UserHealthPlan>> getLatestPlans(@RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(userHealthPlanService.getLatestPlans(limit));
    }

    /**
     * 获取健康计划统计信息
     *
     * @return 健康计划统计信息
     */
    @ApiOperation(value = "获取健康计划统计信息", notes = "管理员可以查看健康计划的统计数据，如总数、状态分类统计等")
    @GetMapping("/statistics")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Map<String, Object>> getPlanStatistics() {
        return ApiResponse.success(userHealthPlanService.getPlanStatistics());
    }

    /**
     * 批量更新健康计划完成进度
     *
     * @param progressUpdates 包含计划ID及进度的更新列表
     * @return 更新操作是否成功
     */
    @ApiOperation(value = "批量更新健康计划完成进度", notes = "管理员可以批量更新健康计划完成进度（百分比）")
    @PutMapping("/update/progress/batch")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Boolean> batchUpdatePlanProgress(@RequestBody Map<Long, Float> progressUpdates) {
        userHealthPlanService.batchUpdatePlanProgress(progressUpdates);
        return ApiResponse.success(true);
    }
}
