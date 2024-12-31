package com.foodrecord.core.optimization;

import org.springframework.stereotype.Component;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.atomic.AtomicLong;
import java.util.List;

@Component
public class SystemOptimizer {
    
    private final CacheOptimizer cacheOptimizer;
    private final QueryOptimizer queryOptimizer;
    private final ThreadPoolOptimizer threadPoolOptimizer;
    private final AtomicLong rejectedCount = new AtomicLong(0);

    public SystemOptimizer(CacheOptimizer cacheOptimizer, QueryOptimizer queryOptimizer, ThreadPoolOptimizer threadPoolOptimizer) {
        this.cacheOptimizer = cacheOptimizer;
        this.queryOptimizer = queryOptimizer;
        this.threadPoolOptimizer = threadPoolOptimizer;
    }

    public OptimizationReport analyzeSystemPerformance() {
        OptimizationReport report = new OptimizationReport();
        
        // 分析缓存使用情况
        report.setCacheAnalysis(cacheOptimizer.analyzeCacheEfficiency());
        
        // 分析SQL查询性能
        OptimizationReport.QueryAnalysis queryAnalysis = queryOptimizer.analyzeSlowQueries();
        report.setQueryAnalysis(queryAnalysis);
        
        // 分析线程池使用情况
        OptimizationReport.ThreadPoolAnalysis threadPoolAnalysis = threadPoolOptimizer.analyzeThreadPoolMetrics();
        report.setThreadPoolAnalysis(threadPoolAnalysis);
        
        return report;
    }
    
    public void applyOptimizations(OptimizationReport report) {
        // 优化缓存配置
        if (report.getCacheAnalysis().requiresOptimization()) {
            cacheOptimizer.optimizeCacheConfig();
        }
        
        // 优化查询
        if (report.getQueryAnalysis().requiresOptimization()) {
            queryOptimizer.optimizeSlowQueries();
            
            // 获取优化建议并设置
            List<String> suggestions = queryOptimizer.getOptimizationSuggestions();
            if (suggestions != null && !suggestions.isEmpty()) {
                report.getQueryAnalysis().setSuggestions(suggestions);
            }
        }
        
        // 优化线程池
        if (report.getThreadPoolAnalysis().requiresOptimization()) {
            ThreadPoolExecutor executor = threadPoolOptimizer.getThreadPool();
            if (executor != null) {
                int currentActive = executor.getActiveCount();
                int queueSize = executor.getQueue().size();
                int corePoolSize = executor.getCorePoolSize();
                
                // 根据负载调整线程池大小
                if (queueSize > 100 || currentActive >= corePoolSize) {
                    threadPoolOptimizer.adjustThreadPoolSize("defaultPool", executor);
                }
                
                // 更新拒绝任务计数
                report.getThreadPoolAnalysis().setRejections(rejectedCount.get());
            }
        }
    }
    
    public void incrementRejectedCount() {
        rejectedCount.incrementAndGet();
    }
    
    public long getRejectedCount() {
        return rejectedCount.get();
    }
} 