package com.foodrecord.core.optimization;

import org.springframework.stereotype.Component;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.atomic.AtomicLong;

@Component
public class ThreadPoolOptimizer {
    private ThreadPoolExecutor threadPool;
    private final AtomicLong rejectedTaskCount = new AtomicLong(0);
    
    public OptimizationReport.ThreadPoolAnalysis analyzeThreadPoolMetrics() {
        OptimizationReport.ThreadPoolAnalysis analysis = new OptimizationReport().getThreadPoolAnalysis();
        
        if (threadPool != null) {
            // 计算线程池利用率
            int activeThreads = threadPool.getActiveCount();
            int maxThreads = threadPool.getMaximumPoolSize();
            double utilization = (double) activeThreads / maxThreads;
            analysis.setUtilization(utilization);
            
            // 获取队列大小
            analysis.setQueueSize(threadPool.getQueue().size());
            
            // 获取拒绝任务数
            analysis.setRejections(rejectedTaskCount.get());
            
            // 添加其他指标
            analysis.addThreadPoolMetric("activeThreads", activeThreads);
            analysis.addThreadPoolMetric("maxThreads", maxThreads);
            analysis.addThreadPoolMetric("corePoolSize", threadPool.getCorePoolSize());
        }
        
        return analysis;
    }
    
    public void adjustThreadPoolSize(String poolName, ThreadPoolExecutor executor) {
        if (executor != null) {
            int currentActive = executor.getActiveCount();
            int queueSize = executor.getQueue().size();
            int corePoolSize = executor.getCorePoolSize();
            
            // 根据负载调整线程池大小
            if (queueSize > 100 || currentActive >= corePoolSize) {
                int newSize = Math.min(executor.getMaximumPoolSize(), corePoolSize + 2);
                executor.setCorePoolSize(newSize);
            } else if (queueSize < 10 && currentActive < corePoolSize / 2) {
                int newSize = Math.max(2, corePoolSize - 1);
                executor.setCorePoolSize(newSize);
            }
        }
    }
    
    public ThreadPoolExecutor getThreadPool() {
        return threadPool;
    }
    
    public void setThreadPool(ThreadPoolExecutor threadPool) {
        this.threadPool = threadPool;
    }
    
    public void incrementRejectedCount() {
        rejectedTaskCount.incrementAndGet();
    }
    
    public long getRejectedCount() {
        return rejectedTaskCount.get();
    }
} 