package com.foodrecord.core.flow.monitor;

public enum HealthLevel {
    HEALTHY("系统运行正常"),
    WARNING("系统出现警告"),
    CRITICAL("系统处于危险状态"),
    UNKNOWN("系统状态未知");

    private final String description;

    HealthLevel(String description) {
        this.description = description;
    }

    public String getDescription() {
        return description;
    }
} 