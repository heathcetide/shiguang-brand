// TODO ml - module
//package com.foodrecord.core.flow.optimizer;
//
//import com.foodrecord.core.flow.analytics.FlowAnalytics;
//import com.foodrecord.core.flow.monitor.FlowPerformanceMonitor;
//import com.foodrecord.core.flow.performance.NodePerformanceStats;
//import com.foodrecord.core.flow.model.FlowStructure;
//import com.foodrecord.core.flow.analytics.NodeExecutionPattern;
//import org.springframework.stereotype.Component;
//import java.time.LocalDateTime;
//import java.util.*;
//
//@Component
//public class FlowOptimizer {
//    private final FlowAnalytics flowAnalytics;
//    private final FlowPerformanceMonitor performanceMonitor;
//
//    public FlowOptimizer(FlowAnalytics flowAnalytics, FlowPerformanceMonitor performanceMonitor) {
//        this.flowAnalytics = flowAnalytics;
//        this.performanceMonitor = performanceMonitor;
//    }
//
//    public OptimizationReport generateOptimizationSuggestions(String flowId) {
//        OptimizationReport report = new OptimizationReport();
//        report.setFlowId(flowId);
//        report.setGeneratedTime(LocalDateTime.now());
//
//        // 分析性能瓶颈
//        analyzeBottlenecks(flowId, report);
//
//        // 资源使用优化
//        analyzeResourceUsage(flowId, report);
//
//        // 并行执行建议
//        analyzeParallelizationOpportunities(flowId, report);
//
//        // 缓存优化建议
//        analyzeCachingOpportunities(flowId, report);
//
//        return report;
//    }
//
//    private void analyzeBottlenecks(String flowId, OptimizationReport report) {
//        Map<String, NodePerformanceStats> nodeStats = performanceMonitor.getAllNodeStats(flowId);
//
//        List<OptimizationReport.OptimizationSuggestion> suggestions = new ArrayList<>();
//        nodeStats.forEach((nodeId, stats) -> {
//            if (stats.getAverageExecutionTime() > 1000) { // 1秒阈值
//                suggestions.add(new OptimizationReport.OptimizationSuggestion(
//                    OptimizationType.PERFORMANCE_BOTTLENECK,
//                    String.format("Node %s has high average execution time (%.2f ms)",
//                        nodeId, stats.getAverageExecutionTime()),
//                    Arrays.asList(
//                        "Consider optimizing the node implementation",
//                        "Consider adding caching mechanism",
//                        "Consider splitting into multiple nodes"
//                    )
//                ));
//            }
//        });
//
//        report.addSuggestions(suggestions);
//    }
//
//    private void analyzeResourceUsage(String flowId, OptimizationReport report) {
//        OptimizationReport.ResourceUsageAnalysis analysis = new OptimizationReport.ResourceUsageAnalysis();
//        Map<String, NodePerformanceStats> nodeStats = performanceMonitor.getAllNodeStats(flowId);
//
//        // 分析CPU效率
//        double avgCpuUsage = nodeStats.values().stream()
//            .mapToDouble(NodePerformanceStats::getCpuUsage)
//            .average()
//            .orElse(0.0);
//        analysis.setCpuEfficiency(100.0 - avgCpuUsage);
//
//        // 分析内存效率
//        double avgMemoryUsage = nodeStats.values().stream()
//            .mapToDouble(NodePerformanceStats::getMemoryUsage)
//            .average()
//            .orElse(0.0);
//        analysis.setMemoryEfficiency(100.0 - avgMemoryUsage);
//
//        // 识别资源瓶颈
//        List<OptimizationReport.ResourceBottleneck> bottlenecks = new ArrayList<>();
//        if (avgCpuUsage > 80.0) {
//            OptimizationReport.ResourceBottleneck bottleneck = new OptimizationReport.ResourceBottleneck();
//            bottleneck.setResource("CPU");
//            bottleneck.setUtilizationRate(avgCpuUsage);
//            bottleneck.setImpact("High CPU usage may cause performance degradation");
//            bottleneck.setOptimizationSuggestions(Arrays.asList(
//                "Optimize CPU-intensive operations",
//                "Consider parallel processing",
//                "Implement caching for expensive computations"
//            ));
//            bottlenecks.add(bottleneck);
//        }
//
//        if (avgMemoryUsage > 85.0) {
//            OptimizationReport.ResourceBottleneck bottleneck = new OptimizationReport.ResourceBottleneck();
//            bottleneck.setResource("Memory");
//            bottleneck.setUtilizationRate(avgMemoryUsage);
//            bottleneck.setImpact("High memory usage may cause OOM errors");
//            bottleneck.setOptimizationSuggestions(Arrays.asList(
//                "Implement memory pooling",
//                "Optimize data structures",
//                "Add memory limits to operations"
//            ));
//            bottlenecks.add(bottleneck);
//        }
//
//        analysis.setBottlenecks(bottlenecks);
//        report.setResourceAnalysis(analysis);
//    }
//
//    private void analyzeParallelizationOpportunities(String flowId, OptimizationReport report) {
//        FlowStructure structure = flowAnalytics.getFlowStructure(flowId);
//        List<Set<String>> independentNodes = findIndependentNodes(structure);
//
//        if (!independentNodes.isEmpty()) {
//            independentNodes.forEach(nodes -> {
//                report.addSuggestion(new OptimizationReport.OptimizationSuggestion(
//                    OptimizationType.PARALLELIZATION,
//                    String.format("Nodes %s can be executed in parallel", nodes),
//                    Arrays.asList(
//                        "Add parallel execution configuration",
//                        "Configure appropriate thread pool size",
//                        "Monitor parallel execution performance"
//                    )
//                ));
//            });
//        }
//    }
//
//    private void analyzeCachingOpportunities(String flowId, OptimizationReport report) {
//        Map<String, NodeExecutionPattern> patterns =
//            flowAnalytics.analyzeNodeExecutionPatterns(flowId);
//
//        patterns.forEach((nodeId, pattern) -> {
//            if (pattern.getInputOutputCorrelation() > 0.9) { // 高输入输出相关性
//                report.addSuggestion(new OptimizationReport.OptimizationSuggestion(
//                    OptimizationType.CACHING,
//                    String.format("Node %s shows high input-output correlation", nodeId),
//                    Arrays.asList(
//                        "Implement result caching",
//                        "Configure cache expiration policy",
//                        "Monitor cache hit rate"
//                    )
//                ));
//            }
//        });
//    }
//
//    private List<Set<String>> findIndependentNodes(FlowStructure structure) {
//        List<Set<String>> result = new ArrayList<>();
//        Map<String, List<String>> dependencies = structure.getDependencies();
//
//        // 使用简单的贪心算法查找独立节点组
//        Set<String> remainingNodes = new HashSet<>(dependencies.keySet());
//
//        while (!remainingNodes.isEmpty()) {
//            Set<String> independentGroup = new HashSet<>();
//            Iterator<String> it = remainingNodes.iterator();
//
//            while (it.hasNext()) {
//                String node = it.next();
//                boolean isIndependent = true;
//
//                // 检查与当前组中的节点是否有依赖关系
//                for (String groupNode : independentGroup) {
//                    if (hasDependency(dependencies, node, groupNode) ||
//                        hasDependency(dependencies, groupNode, node)) {
//                        isIndependent = false;
//                        break;
//                    }
//                }
//
//                if (isIndependent) {
//                    independentGroup.add(node);
//                    it.remove();
//                }
//            }
//
//            if (!independentGroup.isEmpty()) {
//                result.add(independentGroup);
//            }
//        }
//
//        return result;
//    }
//
//    private boolean hasDependency(Map<String, List<String>> dependencies,
//                                String from, String to) {
//        List<String> deps = dependencies.get(from);
//        return deps != null && (deps.contains(to) ||
//            deps.stream().anyMatch(d -> hasDependency(dependencies, d, to)));
//    }
//}