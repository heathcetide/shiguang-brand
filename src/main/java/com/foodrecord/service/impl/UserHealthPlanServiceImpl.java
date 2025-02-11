package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.foodrecord.mapper.UserHealthPlanMapper;
import com.foodrecord.model.entity.UserHealthPlan;
import com.foodrecord.model.entity.plan.AIPlanResponse;
import com.foodrecord.model.entity.plan.DailyPlan;
import com.foodrecord.service.UserHealthPlanService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.*;

@Service
public class UserHealthPlanServiceImpl extends ServiceImpl<UserHealthPlanMapper, UserHealthPlan> implements UserHealthPlanService{

    @Resource
    private UserHealthPlanMapper userHealthPlanMapper;

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();


    @Override
    @Transactional
    public UserHealthPlan createHealthPlan(UserHealthPlan plan) {
        userHealthPlanMapper.insert(plan);
        return plan;
    }

    @Override
    @Transactional
    public UserHealthPlan updateHealthPlan(UserHealthPlan plan) {
        userHealthPlanMapper.updateById(plan);
        return plan;
    }

    @Override
    @Transactional
    public void deleteHealthPlan(Long planId) {
        userHealthPlanMapper.deleteById(planId);
    }

    @Override
    public UserHealthPlan getHealthPlanById(Long planId) {
        return userHealthPlanMapper.selectById(planId);
    }

    @Override
    @Transactional
    public void saveGeneratedPlans(Long userId, Long goalId, AIPlanResponse aiPlanResponse) {
        List<UserHealthPlan> plans = new ArrayList<>();
        for (DailyPlan dailyPlan : aiPlanResponse.getDailyPlans()) {
            // 检查是否已存在计划
            UserHealthPlan existingPlan = userHealthPlanMapper.selectByUserIdAndDate(userId, dailyPlan.getDate());
            if (existingPlan != null) {
                // 如果已存在，跳过该日期计划
                continue;
            }

            UserHealthPlan plan = new UserHealthPlan();
            plan.setUserId(userId);
            plan.setGoalId(goalId);
            plan.setPlanDate(dailyPlan.getDate());
            try {
                // 将 List<String> 转换为 JSON 字符串
                plan.setMeals(OBJECT_MAPPER.writeValueAsString(dailyPlan.getMeals()));
                plan.setExercises(OBJECT_MAPPER.writeValueAsString(dailyPlan.getExercises()));
            } catch (Exception e) {
                e.printStackTrace();
                throw new RuntimeException("JSON 转换失败: " + e.getMessage());
            }
            plan.setPlanCategory("饮食和运动");
            plan.setPlanContent(dailyPlan.getMeals() + " + " + dailyPlan.getExercises());
            plan.setTodayExerciseTarget(dailyPlan.getExerciseMinutes());
            plan.setTodayCalorieTarget(dailyPlan.getCalories());
            plan.setStatus("未开始");
            plans.add(plan);
        }
        if (!plans.isEmpty()) {
            userHealthPlanMapper.insertBatch(plans);
        }
    }


    @Override
    @Transactional
    public void updatePlanProgress(Long planId, Float completedExercise, Float completedCalories) {
        UserHealthPlan plan = userHealthPlanMapper.selectById(planId);
        if (plan != null) {
            // 更新完成量
            plan.setTodayExerciseCompleted(completedExercise);
            plan.setTodayCalorieCompleted(completedCalories);

            // 计算运动和卡路里完成比例（以50%权重）
            float exerciseProgress = completedExercise / (plan.getTodayExerciseTarget() == null || plan.getTodayExerciseTarget() == 0 ? 1 : plan.getTodayExerciseTarget());
            float calorieProgress = completedCalories / (plan.getTodayCalorieTarget() == null || plan.getTodayCalorieTarget() == 0 ? 1 : plan.getTodayCalorieTarget());
            float progress = Math.min(100, (exerciseProgress + calorieProgress) * 50); // 权重相加

            // 更新进度和状态
            plan.setProgress(progress);
            if (progress >= 100) {
                plan.setStatus("已结束");
            } else if (progress > 0) {
                plan.setStatus("进行中");
            }

            userHealthPlanMapper.updateById(plan);
        }
    }
    @Override
    public List<UserHealthPlan> getPlansByDateRange(Long userId, Date startDate, Date endDate) {
        return userHealthPlanMapper.selectPlansByDateRange(userId, startDate, endDate);
    }

    @Override
    public void updatePlanStatus(Long planId, String status) {
        UserHealthPlan plan = userHealthPlanMapper.selectById(planId);
        if (plan != null) {
            plan.setStatus(status);
            userHealthPlanMapper.insert(plan);
        }
    }

    @Override
    public void batchDeleteHealthPlans(List<Long> planIds) {
        userHealthPlanMapper.deleteBatchByIds(planIds);
    }

    @Override
    public List<UserHealthPlan> getHealthPlansByUserId(Long userId) {
        return userHealthPlanMapper.findByUserId(userId);
    }

    @Override
    public List<UserHealthPlan> getAllHealthPlans(int page, int size, String keyword) {
        // 计算分页偏移量
        int offset = (page - 1) * size;
        return userHealthPlanMapper.findAllWithPaginationAndKeyword(offset, size, keyword);
    }


    /**
     * 批量更新健康计划状态
     *
     * @param updates 包含计划ID和状态的键值对
     */
    @Override
    public void batchUpdatePlanStatus(Map<Long, String> updates) {
        for (Map.Entry<Long, String> entry : updates.entrySet()) {
            UserHealthPlan plan = userHealthPlanMapper.selectById(entry.getKey());
            if (plan != null) {
                plan.setStatus(entry.getValue());
                userHealthPlanMapper.insert(plan);
            }
        }
    }

    /**
     * 根据分类获取健康计划
     *
     * @param category 计划分类
     * @return 分类对应的健康计划列表
     */
    @Override
    public List<UserHealthPlan> getPlansByCategory(String category) {
        return userHealthPlanMapper.findByCategory(category);
    }

    /**
     * 获取指定时间范围内的健康计划
     *
     * @param startDate 开始日期
     * @param endDate   结束日期
     * @return 时间范围内的健康计划列表
     */
    @Override
    public List<UserHealthPlan> getAllPlansByDateRange(String startDate, String endDate) {
        return userHealthPlanMapper.findByDateRange(startDate, endDate);
    }

    /**
     * 获取最新创建的健康计划
     *
     * @param limit 限制条数
     * @return 最新创建的健康计划列表
     */
    @Override
    public List<UserHealthPlan> getLatestPlans(int limit) {
        return userHealthPlanMapper.findLatestPlans(limit);
    }

    /**
     * 获取健康计划统计信息
     *
     * @return 健康计划统计信息
     */
    @Override
    public Map<String, Object> getPlanStatistics() {
        Map<String, Object> statistics = new HashMap<>();
        int totalPlans = userHealthPlanMapper.countTotalPlans();
        Map<String, Long> statusCounts = userHealthPlanMapper.countPlansByStatus();

        statistics.put("totalPlans", totalPlans);
        statistics.put("statusCounts", statusCounts);
        return statistics;
    }

    /**
     * 批量更新健康计划完成进度
     *
     * @param progressUpdates 包含计划ID和进度的键值对
     */
    @Override
    public void batchUpdatePlanProgress(Map<Long, Float> progressUpdates) {
        for (Map.Entry<Long, Float> entry : progressUpdates.entrySet()) {
            UserHealthPlan plan = userHealthPlanMapper.selectById(entry.getKey());
            if (plan != null) {
                plan.setProgress(entry.getValue());
                userHealthPlanMapper.insert(plan);
            }
        }
    }
}
