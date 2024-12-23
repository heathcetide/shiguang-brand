package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.entity.user.UserHealthPlan;
import com.foodrecord.model.entity.plan.AIPlanResponse;

import java.util.Date;
import java.util.List;
import java.util.Map;

public interface UserHealthPlanService extends IService<UserHealthPlan> {

    UserHealthPlan createHealthPlan(UserHealthPlan plan);

    UserHealthPlan updateHealthPlan(UserHealthPlan plan);

    void deleteHealthPlan(Long planId);

    UserHealthPlan getHealthPlanById(Long planId);

    void saveGeneratedPlans(Long userIdFromToken, Long id, AIPlanResponse aiPlanResponse);

    void updatePlanProgress(Long planId, Float completedExercise, Float completedCalories);

    List<UserHealthPlan> getPlansByDateRange(Long userId, Date startDate, Date endDate);

    void updatePlanStatus(Long planId, String status);

    void batchDeleteHealthPlans(List<Long> planIds);

    List<UserHealthPlan> getHealthPlansByUserId(Long userId);

    List<UserHealthPlan> getAllHealthPlans(int page, int size, String keyword);

    
    void batchUpdatePlanStatus(Map<Long, String> updates);

    List<UserHealthPlan> getPlansByCategory(String category);

    List<UserHealthPlan> getAllPlansByDateRange(String startDate, String endDate);

    List<UserHealthPlan> getLatestPlans(int limit);

    Map<String, Object> getPlanStatistics();

    void batchUpdatePlanProgress(Map<Long, Float> progressUpdates);
}
