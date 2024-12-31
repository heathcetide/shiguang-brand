package com.foodrecord.core.flow.optimizer;

public enum OptimizationType {
    PERFORMANCE_BOTTLENECK("性能瓶颈优化"),
    PARALLELIZATION("并行化优化"),
    CACHING("缓存优化"),
    RESOURCE_USAGE("资源使用优化"),
    MEMORY_OPTIMIZATION("内存优化"),
    THREAD_POOL_TUNING("线程池调优"),
    DATA_STRUCTURE("数据结构优化"),
    ALGORITHM_IMPROVEMENT("算法改进");

    private final String description;

    OptimizationType(String description) {
        this.description = description;
    }

    public String getDescription() {
        return description;
    }
} 