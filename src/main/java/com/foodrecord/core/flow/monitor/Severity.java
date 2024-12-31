package com.foodrecord.core.flow.monitor;

public enum Severity {
    INFO("信息"),
    WARNING("警告"),
    CRITICAL("严重");

    private final String description;

    Severity(String description) {
        this.description = description;
    }

    public String getDescription() {
        return description;
    }

    public boolean isLowerThan(int i) {

        return false;
    }
}