package com.foodrecord.core.optimization;

import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class CacheOptimizer {
    private final Map<String, CacheStats> cacheStats;
    private final double hitRateThreshold;
    private final long ttlThreshold;

    public CacheOptimizer() {
        this(0.8, 3600000); // 默认命中率阈值80%，TTL阈值1小时
    }

    public CacheOptimizer(double hitRateThreshold, long ttlThreshold) {
        this.cacheStats = new HashMap<>();
        this.hitRateThreshold = hitRateThreshold;
        this.ttlThreshold = ttlThreshold;
    }

    public CacheAnalysis analyze(QueryOptimizationReport.SlowQuery query) {
        CacheAnalysis analysis = new CacheAnalysis();
        
        // 获取查询的缓存统计信息
        CacheStats stats = cacheStats.computeIfAbsent(query.getSql(), k -> new CacheStats());
        
        // 分析缓存命中率
        if (stats.getHitRate() < hitRateThreshold) {
            analysis.addSuggestion(new CacheSuggestion(
                CacheSuggestion.Type.INCREASE_TTL,
                "Consider increasing cache TTL to improve hit rate",
                calculateOptimalTtl(stats)
            ));
        }
        
        // 分析缓存大小
        if (stats.getSize() > 10000) {
            analysis.addSuggestion(new CacheSuggestion(
                CacheSuggestion.Type.REDUCE_SIZE,
                "Consider reducing cache size to prevent memory issues",
                    5000L
            ));
        }
        
        // 分析缓存更新策略
        if (stats.getUpdateFrequency() > 100) {
            analysis.addSuggestion(new CacheSuggestion(
                CacheSuggestion.Type.CHANGE_STRATEGY,
                "Consider using write-through caching for frequently updated data",
                null
            ));
        }
        
        return analysis;
    }

    public OptimizationReport.CacheAnalysis analyzeCacheEfficiency() {
        OptimizationReport.CacheAnalysis analysis = new OptimizationReport.CacheAnalysis();
        
        // 计算整体命中率
        double totalHitRate = calculateOverallHitRate();
        analysis.setHitRate(totalHitRate);
        
        // 计算缓存大小
        long totalSize = calculateTotalCacheSize();
        analysis.setSize(totalSize);
        
        // 计算驱逐次数
        long totalEvictions = calculateTotalEvictions();
        analysis.setEvictions(totalEvictions);
        
        // 添加详细指标
        for (Map.Entry<String, CacheStats> entry : cacheStats.entrySet()) {
            CacheStats stats = entry.getValue();
            analysis.addCacheMetric("hitRate." + entry.getKey(), stats.getHitRate());
            analysis.addCacheMetric("size." + entry.getKey(), stats.getSize());
            analysis.addCacheMetric("updateFreq." + entry.getKey(), stats.getUpdateFrequency());
        }
        
        return analysis;
    }

    public void optimizeCacheConfig() {
        // 分析当前缓存效率
        OptimizationReport.CacheAnalysis analysis = analyzeCacheEfficiency();
        
        // 如果需要优化
        if (analysis.requiresOptimization()) {
            // 调整TTL
            if (analysis.getHitRate() < hitRateThreshold) {
                adjustTTL();
            }
            
            // 调整缓存大小
            if (analysis.getEvictions() > 1000) {
                adjustCacheSize();
            }
            
            // 清理不常用的缓存项
            cleanupUnusedEntries();
        }
    }

    private double calculateOverallHitRate() {
        long totalHits = 0;
        long totalAccesses = 0;
        
        for (CacheStats stats : cacheStats.values()) {
            totalHits += stats.hits;
            totalAccesses += stats.hits + stats.misses;
        }
        
        return totalAccesses > 0 ? (double) totalHits / totalAccesses : 0.0;
    }

    private long calculateTotalCacheSize() {
        return cacheStats.values().stream()
                .mapToLong(CacheStats::getSize)
                .sum();
    }

    private long calculateTotalEvictions() {
        return cacheStats.values().stream()
                .mapToLong(stats -> stats.updates)
                .sum();
    }

    private void adjustTTL() {
        // TODO: 实现TTL调整逻辑
    }

    private void adjustCacheSize() {
        // TODO: 实现缓存大小调整逻辑
    }

    private void cleanupUnusedEntries() {
        // TODO: 实现缓存清理逻辑
    }

    private long calculateOptimalTtl(CacheStats stats) {
        // TODO: 实现最优TTL计算逻辑
        return ttlThreshold * 2;
    }

    public void recordCacheAccess(String sql, boolean hit) {
        cacheStats.computeIfAbsent(sql, k -> new CacheStats()).recordAccess(hit);
    }

    public void recordCacheUpdate(String sql) {
        cacheStats.computeIfAbsent(sql, k -> new CacheStats()).recordUpdate();
    }

    private static class CacheStats {
        private long hits;
        private long misses;
        private long updates;
        private long size;
        private final long creationTime;

        public CacheStats() {
            this.hits = 0;
            this.misses = 0;
            this.updates = 0;
            this.size = 0;
            this.creationTime = System.currentTimeMillis();
        }

        public void recordAccess(boolean hit) {
            if (hit) {
                hits++;
            } else {
                misses++;
            }
        }

        public void recordUpdate() {
            updates++;
        }

        public double getHitRate() {
            long total = hits + misses;
            return total > 0 ? (double) hits / total : 0.0;
        }

        public long getSize() {
            return size;
        }

        public void setSize(long size) {
            this.size = size;
        }

        public double getUpdateFrequency() {
            long uptime = System.currentTimeMillis() - creationTime;
            return uptime > 0 ? (double) updates / (uptime / 1000.0) : 0.0;
        }
    }
} 