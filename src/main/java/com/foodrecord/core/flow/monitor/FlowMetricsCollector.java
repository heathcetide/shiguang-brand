package com.foodrecord.core.flow.monitor;

import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;
import java.util.concurrent.TimeUnit;

@Component
public class FlowMetricsCollector {
    private final MeterRegistry registry;
    
    public FlowMetricsCollector(MeterRegistry registry) {
        this.registry = registry;
    }
    
    public void recordFlowExecution(String flowId, long duration, boolean success) {
        registry.timer("flow.execution.duration", "flowId", flowId)
            .record(duration, TimeUnit.MILLISECONDS);
            
        registry.counter("flow.execution.count", 
            "flowId", flowId, 
            "status", success ? "success" : "failure")
            .increment();
    }
    
    public void recordNodeExecution(String flowId, String nodeId, 
                                  long duration, boolean success) {
        registry.timer("node.execution.duration", 
            "flowId", flowId,
            "nodeId", nodeId)
            .record(duration, TimeUnit.MILLISECONDS);
            
        registry.counter("node.execution.count",
            "flowId", flowId,
            "nodeId", nodeId,
            "status", success ? "success" : "failure")
            .increment();
    }
} 