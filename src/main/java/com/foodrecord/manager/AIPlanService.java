package com.foodrecord.manager;

import com.foodrecord.model.entity.user.UserHealthPlan;
import com.foodrecord.model.entity.plan.AIPlanResponse;
import com.foodrecord.model.entity.plan.DailyPlan;
import com.foodrecord.model.entity.plan.UserPlanInput;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.stream.Collectors;

public class AIPlanService {
    public static AIPlanResponse generatePlan(UserPlanInput input) {
        // 模拟 AI 服务的 HTTP 调用
        // 实际生产中应使用 RestTemplate 或 WebClient 调用远程 AI 服务

        // TODO: 调用 AI 接口，传入用户数据，返回计划
        AIPlanResponse response = new AIPlanResponse();
        response.setDailyPlans(generateMockPlans(input)); // Mock 示例
        return response;
    }

    private static List<DailyPlan> generateMockPlans(UserPlanInput input) {
        List<DailyPlan> plans = new ArrayList<>();

        // 模拟生成 7 天的计划
        for (int i = 0; i < 7; i++) {
            DailyPlan plan = new DailyPlan();
            LocalDate localDate = LocalDate.now().plusDays(i);
            Date date = Date.from(localDate.atStartOfDay(ZoneId.systemDefault()).toInstant());
            plan.setDate(date); // 设置日期，类型为 Date

            plan.setMeals(Arrays.asList("早餐: 燕麦 + 鸡蛋", "午餐: 鸡胸肉 + 西兰花", "晚餐: 牛排 + 蔬菜"));
            plan.setExercises(Arrays.asList("跑步30分钟", "瑜伽20分钟"));
            plan.setCalories(2000F); // 示例卡路里
            plan.setExerciseMinutes(50F); // 示例运动时间
            plans.add(plan);
        }
        return plans;
    }

    public void saveGeneratedPlans(Long userId, Long goalId, AIPlanResponse response) {
        List<UserHealthPlan> plans = response.getDailyPlans().stream().map(plan -> {
            UserHealthPlan healthPlan = new UserHealthPlan();
            healthPlan.setUserId(userId);
            healthPlan.setGoalId(goalId);
            healthPlan.setPlanDate(plan.getDate());
            healthPlan.setPlanCategory("综合计划");
            healthPlan.setPlanContent(String.format("饮食: %s; 运动: %s",
                    String.join(", ", plan.getMeals()),
                    String.join(", ", plan.getExercises())));
            healthPlan.setTodayCalorieTarget(plan.getCalories());
            healthPlan.setTodayExerciseTarget(plan.getExerciseMinutes());
            return healthPlan;
        }).collect(Collectors.toList());

//        saveBatch(plans); // 批量插入数据库
    }

}
