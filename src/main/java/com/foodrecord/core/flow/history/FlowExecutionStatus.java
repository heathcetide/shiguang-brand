package com.foodrecord.core.flow.history;

public enum FlowExecutionStatus {
    PENDING("等待执行"),
    RUNNING("正在执行"),
    COMPLETED("执行完成"),
    FAILED("执行失败"),
    CANCELLED("已取消"),
    PAUSED("已暂停");

    private final String description;

    FlowExecutionStatus(String description) {
        this.description = description;
    }

    public String getDescription() {
        return description;
    }
} 