package com.foodrecord.core.flow.api;

import com.foodrecord.core.flow.FlowEngine;
import com.foodrecord.core.flow.history.FlowExecutionHistory;
import com.foodrecord.core.flow.model.FlowNode;
import com.foodrecord.core.flow.monitor.FlowMonitor;
import com.foodrecord.core.flow.performance.FlowPerformanceAnalyzer;
import com.foodrecord.core.flow.performance.PerformanceReport;
//import com.foodrecord.core.flow.persistence.FlowExecutionRepository;
import com.foodrecord.core.flow.visualization.FlowVisualizer;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.MediaType;

import java.util.List;

@RestController
@RequestMapping("/api/flow/monitor")
public class FlowMonitorController {
    private final FlowEngine flowEngine;
    private final FlowMonitor flowMonitor;
    private final FlowPerformanceAnalyzer performanceAnalyzer;
    private final FlowVisualizer flowVisualizer;
//    private final FlowExecutionRepository executionRepository;

    public FlowMonitorController(FlowEngine flowEngine, FlowMonitor flowMonitor, FlowPerformanceAnalyzer performanceAnalyzer, FlowVisualizer flowVisualizer) {
        this.flowEngine = flowEngine;
        this.flowMonitor = flowMonitor;
        this.performanceAnalyzer = performanceAnalyzer;
        this.flowVisualizer = flowVisualizer;
//        this.executionRepository = executionRepository;
    }

    @GetMapping("/{flowId}/metrics")
    public FlowMonitor.FlowMetrics getFlowMetrics(@PathVariable String flowId) {
        return flowMonitor.getMetrics(flowId);
    }
    
    @GetMapping("/{flowId}/history")
    public List<FlowExecutionHistory> getFlowHistory(@PathVariable String flowId) {
//        return executionRepository.findByFlowId(flowId);
        return null;
    }
    
    @GetMapping("/{flowId}/performance")
    public PerformanceReport getPerformanceReport(@PathVariable String flowId) {
//        List<FlowExecutionHistory> histories = executionRepository.findByFlowId(flowId);
//        return performanceAnalyzer.analyzeFlow(flowId, histories);
        return null;
    }
    
    @GetMapping(value = "/{flowId}/visualization", 
                produces = MediaType.TEXT_PLAIN_VALUE)
    public String getFlowVisualization(@PathVariable String flowId) {
//        List<FlowNode> nodes = flowEngine.getFlowNodes(flowId);
//        return flowVisualizer.generateMermaidDiagram(nodes);
        return null;
    }
    
    @GetMapping("/{flowId}/bottlenecks")
    public List<String> getFlowBottlenecks(@PathVariable String flowId) {
//        List<FlowExecutionHistory> histories = executionRepository.findByFlowId(flowId);
//        return performanceAnalyzer.analyzeFlow(flowId, histories)
//            .getBottlenecks();
        return null;
    }
} 