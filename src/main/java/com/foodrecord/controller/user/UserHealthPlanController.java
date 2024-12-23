package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.entity.user.UserHealthPlan;
import com.foodrecord.service.UserHealthPlanService;
import io.swagger.annotations.Api;
import org.springframework.web.bind.annotation.*;
import javax.annotation.Resource;

@RestController
@RequestMapping("/health-plan")
@Api(tags = "用户计划模块")
public class UserHealthPlanController {

    @Resource
    private UserHealthPlanService userHealthPlanService;

    @PostMapping("/create")
    public ApiResponse<UserHealthPlan> createHealthPlan(@RequestBody UserHealthPlan plan) {
        return ApiResponse.success(userHealthPlanService.createHealthPlan(plan));
    }

    @PutMapping("/update")
    public ApiResponse<UserHealthPlan> updateHealthPlan(@RequestBody UserHealthPlan plan) {
        return ApiResponse.success(userHealthPlanService.updateHealthPlan(plan));
    }

    @DeleteMapping("/delete/{id}")
    public ApiResponse<Boolean> deleteHealthPlan(@PathVariable Long id) {
        userHealthPlanService.deleteHealthPlan(id);
        return ApiResponse.success(true);
    }

    @GetMapping("/get/{id}")
    public ApiResponse<UserHealthPlan> getHealthPlanById(@PathVariable Long id) {
        return ApiResponse.success(userHealthPlanService.getHealthPlanById(id));
    }
}
