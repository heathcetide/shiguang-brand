package com.foodrecord.model.entity.plan;

import io.swagger.annotations.ApiModelProperty;

import java.util.List;

public class AIPlanResponse {
    @ApiModelProperty(value = "每日计划列表")
    private List<DailyPlan> dailyPlans;

    public List<DailyPlan> getDailyPlans() {
        return dailyPlans;
    }

    public void setDailyPlans(List<DailyPlan> dailyPlans) {
        this.dailyPlans = dailyPlans;
    }
}
