package com.foodrecord.core.optimization;

import org.springframework.stereotype.Component;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

@Component
public class ExecutionPlanCache {
    private final ConcurrentMap<String, OptimizedPlan> cache;
    private final int maxSize;
    private long expirationTime;

    public ExecutionPlanCache() {
        this(1000, 3600000); // 默认最大缓存1000条，过期时间1小时
    }

    public ExecutionPlanCache(int maxSize, long expirationTime) {
        this.cache = new ConcurrentHashMap<>();
        this.maxSize = maxSize;
        this.expirationTime = expirationTime;
    }

    public OptimizedPlan get(String sql) {
        OptimizedPlan plan = cache.get(sql);
        if (plan != null && isExpired(plan)) {
            cache.remove(sql);
            return null;
        }
        return plan;
    }

    public void put(String sql, OptimizedPlan plan) {
        if (cache.size() >= maxSize) {
            evictOldest();
        }
        cache.put(sql, plan);
    }

    private boolean isExpired(OptimizedPlan plan) {
        return System.currentTimeMillis() - plan.getTimestamp() > expirationTime;
    }

    private void evictOldest() {
        String oldestKey = null;
        long oldestTimestamp = Long.MAX_VALUE;

        for (ConcurrentMap.Entry<String, OptimizedPlan> entry : cache.entrySet()) {
            if (entry.getValue().getTimestamp() < oldestTimestamp) {
                oldestTimestamp = entry.getValue().getTimestamp();
                oldestKey = entry.getKey();
            }
        }

        if (oldestKey != null) {
            cache.remove(oldestKey);
        }
    }

    public void clear() {
        cache.clear();
    }

    public int size() {
        return cache.size();
    }

    public void remove(String sql) {
        cache.remove(sql);
    }

    public boolean contains(String sql) {
        return cache.containsKey(sql) && !isExpired(cache.get(sql));
    }

    public void setExpirationTime(long expirationTime) {
        // 更新过期时间并清理过期的计划
        this.expirationTime = expirationTime;
        cleanExpired();
    }

    private void cleanExpired() {
        cache.entrySet().removeIf(entry -> isExpired(entry.getValue()));
    }
} 