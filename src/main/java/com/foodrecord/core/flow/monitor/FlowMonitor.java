package com.foodrecord.core.flow.monitor;

import org.springframework.stereotype.Component;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

@Component
public class FlowMonitor {
    private final Map<String, FlowMetrics> flowMetrics = new ConcurrentHashMap<>();
    
    public void recordExecution(String flowId, long duration, boolean success) {
        flowMetrics.computeIfAbsent(flowId, k -> new FlowMetrics())
                  .recordExecution(duration, success);
    }
    
    public FlowMetrics getMetrics(String flowId) {
        return flowMetrics.get(flowId);
    }

    public static class FlowMetrics {
        private AtomicLong totalExecutions = new AtomicLong();
        private AtomicLong successfulExecutions = new AtomicLong();
        private AtomicLong failedExecutions = new AtomicLong();
        private AtomicLong totalDuration = new AtomicLong();
        
        public void recordExecution(long duration, boolean success) {
            totalExecutions.incrementAndGet();
            totalDuration.addAndGet(duration);
            if (success) {
                successfulExecutions.incrementAndGet();
            } else {
                failedExecutions.incrementAndGet();
            }
        }
        
        public double getAverageDuration() {
            long total = totalExecutions.get();
            return total == 0 ? 0 : totalDuration.get() / (double) total;
        }
        
        public double getSuccessRate() {
            long total = totalExecutions.get();
            return total == 0 ? 0 : successfulExecutions.get() / (double) total;
        }

        public AtomicLong getTotalExecutions() {
            return totalExecutions;
        }

        public void setTotalExecutions(AtomicLong totalExecutions) {
            this.totalExecutions = totalExecutions;
        }

        public AtomicLong getSuccessfulExecutions() {
            return successfulExecutions;
        }

        public void setSuccessfulExecutions(AtomicLong successfulExecutions) {
            this.successfulExecutions = successfulExecutions;
        }

        public AtomicLong getFailedExecutions() {
            return failedExecutions;
        }

        public void setFailedExecutions(AtomicLong failedExecutions) {
            this.failedExecutions = failedExecutions;
        }

        public AtomicLong getTotalDuration() {
            return totalDuration;
        }

        public void setTotalDuration(AtomicLong totalDuration) {
            this.totalDuration = totalDuration;
        }
    }

    public Map<String, FlowMetrics> getFlowMetrics() {
        return flowMetrics;
    }
}