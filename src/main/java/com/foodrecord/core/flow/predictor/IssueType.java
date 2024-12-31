package com.foodrecord.core.flow.predictor;

public enum IssueType {
    PERFORMANCE_DEGRADATION("性能退化"),
    RESOURCE_EXHAUSTION("资源耗尽"),
    MEMORY_LEAK("内存泄漏"),
    HIGH_LATENCY("高延迟"),
    ERROR_RATE_INCREASE("错误率增加"),
    THROUGHPUT_DECREASE("吞吐量下降"),
    DEADLOCK_POTENTIAL("死锁潜在风险"),
    RESOURCE_CONTENTION("资源竞争");

    private final String description;

    IssueType(String description) {
        this.description = description;
    }

    public String getDescription() {
        return description;
    }
} 