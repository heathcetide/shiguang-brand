package com.foodrecord.core.flow.monitor;

import io.micrometer.core.instrument.Tag;
import org.springframework.stereotype.Component;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import io.micrometer.core.instrument.MeterRegistry;
import com.foodrecord.core.flow.performance.NodePerformanceStats;
import java.lang.management.ManagementFactory;
import java.lang.management.ThreadMXBean;
import java.lang.Runtime;

@Component
public class FlowPerformanceMonitor {
    private final MeterRegistry registry;
    private final Map<String, PerformanceStats> statsMap = new ConcurrentHashMap<>();
    private final Map<String, FlowMetrics> flowMetrics = new ConcurrentHashMap<>();
    private final Map<String, ActiveFlow> activeFlows = new ConcurrentHashMap<>();

    public FlowPerformanceMonitor(MeterRegistry registry) {
        this.registry = registry;
    }

    public void recordPerformance(String flowId, String nodeId, 
                                long executionTime, long memoryUsage) {
        String key = String.format("%s:%s", flowId, nodeId);
        PerformanceStats stats = statsMap.computeIfAbsent(key, 
            k -> new PerformanceStats());
            
        stats.recordExecution(executionTime, memoryUsage);
        
        // 记录到Micrometer
        registry.timer("flow.node.execution", 
            "flowId", flowId,
            "nodeId", nodeId)
            .record(executionTime, TimeUnit.MILLISECONDS);
            
        registry.gauge("flow.node.memory",
            Arrays.asList(Tag.of("flowId", flowId),
                        Tag.of("nodeId", nodeId)),
            memoryUsage);
    }
    
    public Map<String, NodePerformanceStats> getAllNodeStats(String flowId) {
        Map<String, NodePerformanceStats> result = new HashMap<>();
        
        statsMap.forEach((key, stats) -> {
            if (key.startsWith(flowId + ":")) {
                String nodeId = key.substring(flowId.length() + 1);
                NodePerformanceStats nodeStats = new NodePerformanceStats();
                nodeStats.setNodeId(nodeId);
                nodeStats.setAverageExecutionTime(stats.getAverageExecutionTime());
                nodeStats.setTotalExecutions(stats.getTotalExecutions());
                nodeStats.setSuccessRate(stats.getSuccessRate());
                // TODO: 添加CPU和内存使用率的实际计算
                nodeStats.setCpuUsage(0.0);
                nodeStats.setMemoryUsage(0.0);
                result.put(nodeId, nodeStats);
            }
        });
        
        return result;
    }
    
    public PerformanceStats getStats(String flowId, String nodeId) {
        return statsMap.get(String.format("%s:%s", flowId, nodeId));
    }

    public Map<String, PerformanceStats> getStats(String flowId) {
        Map<String, PerformanceStats> stats = new HashMap<>();
        if (flowId != null) {
            FlowMetrics metrics = flowMetrics.get(flowId);
            if (metrics != null) {
                stats.put(flowId, metrics.toPerformanceStats());
            }
        } else {
            flowMetrics.forEach((id, metrics) -> 
                stats.put(id, metrics.toPerformanceStats()));
        }
        return stats;
    }
    
    public List<ActiveFlow> getActiveFlows() {
        return new ArrayList<>(activeFlows.values());
    }
    
    public SystemMetrics getSystemMetrics() {
        SystemMetrics metrics = new SystemMetrics();
        
        // 获取CPU使用率
        double cpuUsage = ManagementFactory.getOperatingSystemMXBean().getSystemLoadAverage();
        metrics.setCpuUsage(cpuUsage >= 0 ? cpuUsage : 0);
        
        // 获取内存使用情况
        Runtime runtime = Runtime.getRuntime();
        long totalMemory = runtime.totalMemory();
        long freeMemory = runtime.freeMemory();
        double memoryUsage = ((double) (totalMemory - freeMemory) / totalMemory) * 100;
        metrics.setMemoryUsage(memoryUsage);
        
        // 获取活动线程数
        ThreadMXBean threadBean = ManagementFactory.getThreadMXBean();
        metrics.setActiveThreads(threadBean.getThreadCount());
        
        // 获取队列中的任务数（这里使用activeFlows的大小作为示例）
        metrics.setQueuedTasks(activeFlows.size());
        
        return metrics;
    }
    
    public Map<String, FlowMetrics> getFlowMetrics() {
        return new HashMap<>(flowMetrics);
    }

    public static class PerformanceStats {
        private long totalExecutions;
        private double averageExecutionTime;
        private double successRate;
        private Map<String, NodeStats> nodeStats;
        private long totalExecutionTime;
        private long successfulExecutions;

        public PerformanceStats() {
            this.nodeStats = new HashMap<>();
            this.totalExecutions = 0;
            this.totalExecutionTime = 0;
            this.successfulExecutions = 0;
            this.successRate = 1.0;
        }

        public void recordExecution(long executionTime, long memoryUsage) {
            totalExecutions++;
            totalExecutionTime += executionTime;
            averageExecutionTime = (double) totalExecutionTime / totalExecutions;
            successfulExecutions++; // 假设所有执行都是成功的，实际应该根据执行结果来判断
            successRate = (double) successfulExecutions / totalExecutions;
        }

        public long getTotalExecutions() {
            return totalExecutions;
        }

        public void setTotalExecutions(long totalExecutions) {
            this.totalExecutions = totalExecutions;
        }

        public double getAverageExecutionTime() {
            return averageExecutionTime;
        }

        public void setAverageExecutionTime(double averageExecutionTime) {
            this.averageExecutionTime = averageExecutionTime;
        }

        public double getSuccessRate() {
            return successRate;
        }

        public void setSuccessRate(double successRate) {
            this.successRate = successRate;
        }

        public Map<String, NodeStats> getNodeStats() {
            return nodeStats;
        }

        public void setNodeStats(Map<String, NodeStats> nodeStats) {
            this.nodeStats = nodeStats;
        }
    }

    public static class NodeStats {
        private long executionCount;
        private double averageExecutionTime;
        private double errorRate;

        public long getExecutionCount() {
            return executionCount;
        }

        public void setExecutionCount(long executionCount) {
            this.executionCount = executionCount;
        }

        public double getAverageExecutionTime() {
            return averageExecutionTime;
        }

        public void setAverageExecutionTime(double averageExecutionTime) {
            this.averageExecutionTime = averageExecutionTime;
        }

        public double getErrorRate() {
            return errorRate;
        }

        public void setErrorRate(double errorRate) {
            this.errorRate = errorRate;
        }
    }
} 