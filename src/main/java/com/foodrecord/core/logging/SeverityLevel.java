package com.foodrecord.core.logging;

public enum SeverityLevel {
    CRITICAL(1, "系统级严重故障"),
    HIGH(2, "重要功能受影响"),
    MEDIUM(3, "功能部分降级"),
    LOW(4, "轻微影响"),
    INFO(5, "提示信息");

    private final int level;
    private final String description;

    SeverityLevel(int level, String description) {
        this.level = level;
        this.description = description;
    }

    public int getLevel() {
        return level;
    }

    public String getDescription() {
        return description;
    }
} 