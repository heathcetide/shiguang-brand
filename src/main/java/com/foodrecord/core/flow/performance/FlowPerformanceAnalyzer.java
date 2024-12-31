package com.foodrecord.core.flow.performance;

import com.foodrecord.core.flow.FlowEngine;
import com.foodrecord.core.flow.history.FlowExecutionHistory;
import com.foodrecord.core.flow.history.NodeExecutionRecord;
import org.springframework.stereotype.Component;
import java.time.Duration;
import java.util.*;
import java.util.stream.Collectors;

@Component
public class FlowPerformanceAnalyzer {
    private final FlowEngine flowEngine;
    private static final long BOTTLENECK_THRESHOLD = 1000; // 1秒
    
    public FlowPerformanceAnalyzer(FlowEngine flowEngine) {
        this.flowEngine = flowEngine;
    }

    public PerformanceReport analyzeFlow(String flowId, List<FlowExecutionHistory> histories) {
        PerformanceReport report = new PerformanceReport();
        report.setFlowId(flowId);
        
        Map<String, NodePerformanceStats> nodeStats = new HashMap<>();
        
        for (FlowExecutionHistory history : histories) {
            for (NodeExecutionRecord record : history.getNodeRecords()) {
                Duration duration = Duration.between(
                    record.getStartTime(), record.getEndTime());
                    
                nodeStats.computeIfAbsent(record.getNodeId(), 
                    k -> new NodePerformanceStats())
                    .addExecution(duration.toMillis());
            }
        }
        
        report.setNodeStats(nodeStats);
        report.setBottlenecks(identifyBottlenecks(nodeStats));
        return report;
    }

    private List<String> identifyBottlenecks(Map<String, NodePerformanceStats> stats) {
        return stats.entrySet().stream()
                .filter(e -> e.getValue().getAverageExecutionTime() > BOTTLENECK_THRESHOLD)
                .sorted((a, b) -> Double.compare(
                        b.getValue().getAverageExecutionTime(),
                        a.getValue().getAverageExecutionTime()))
                .map(Map.Entry::getKey)
                .collect(Collectors.toList());
    }
} 