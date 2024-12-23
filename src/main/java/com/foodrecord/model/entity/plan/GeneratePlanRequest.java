package com.foodrecord.model.entity.plan;

import io.swagger.annotations.ApiModelProperty;

import java.time.LocalDate;

public class GeneratePlanRequest {
    @ApiModelProperty(value = "计划生成开始日期", example = "2024-12-25", required = true)
    private LocalDate startDate;

    @ApiModelProperty(value = "计划生成结束日期", example = "2025-01-01", required = true)
    private LocalDate endDate;

    public LocalDate getStartDate() {
        return startDate;
    }

    public void setStartDate(LocalDate startDate) {
        this.startDate = startDate;
    }

    public LocalDate getEndDate() {
        return endDate;
    }

    public void setEndDate(LocalDate endDate) {
        this.endDate = endDate;
    }
}
