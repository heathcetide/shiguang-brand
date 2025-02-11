//package com.foodrecord.core.flow.analytics;
////TODO ml
//import com.foodrecord.core.flow.model.FlowStructure;
//import com.foodrecord.core.flow.predictor.ExecutionTimePoint;
//import com.foodrecord.core.flow.predictor.ResourceUsagePoint;
//import org.deeplearning4j.common.resources.ResourceType;
//import java.util.List;
//import java.util.Map;
//
//public interface FlowAnalytics {
//    FlowStructure getFlowStructure(String flowId);
//    Map<String, NodeExecutionPattern> analyzeNodeExecutionPatterns(String flowId);
//    Map<String, Double> analyzeNodePerformance(String flowId);
//    Map<String, Integer> getNodeExecutionCounts(String flowId);
//    Map<String, Double> getNodeErrorRates(String flowId);
//    List<ExecutionTimePoint> getHistoricalExecutionTimes(String flowId);
//    List<ResourceUsagePoint> getHistoricalResourceUsage(String flowId, ResourceType resourceType);
//}