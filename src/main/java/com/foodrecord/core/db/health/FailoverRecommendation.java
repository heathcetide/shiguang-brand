package com.foodrecord.core.db.health;

import com.foodrecord.core.flow.monitor.HealthStatus;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

public class FailoverRecommendation {
    private final boolean shouldFailover;
    private final String targetInstance;
    private final FailoverStrategy strategy;
    private final Map<String, Object> failoverParams;
    private final List<String> preFailoverChecks;
    private final List<String> postFailoverChecks;

    public FailoverRecommendation(boolean shouldFailover, String targetInstance,
                                  FailoverStrategy strategy, Map<String, Object> failoverParams,
                                  List<String> preFailoverChecks, List<String> postFailoverChecks) {
        this.shouldFailover = shouldFailover;
        this.targetInstance = targetInstance;
        this.strategy = strategy;
        this.failoverParams = failoverParams;
        this.preFailoverChecks = preFailoverChecks;
        this.postFailoverChecks = postFailoverChecks;
    }

    public boolean shouldFailover() {
        return shouldFailover;
    }

    public String getTargetInstance() {
        return targetInstance;
    }

    public FailoverStrategy getStrategy() {
        return strategy;
    }

    public Map<String, Object> getFailoverParams() {
        return failoverParams;
    }

    public List<String> getPreFailoverChecks() {
        return preFailoverChecks;
    }

    public List<String> getPostFailoverChecks() {
        return postFailoverChecks;
    }

    public enum FailoverStrategy {
        IMMEDIATE,
        GRACEFUL,
        SCHEDULED
    }
}