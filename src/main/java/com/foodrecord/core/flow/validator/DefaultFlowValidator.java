package com.foodrecord.core.flow.validator;

import com.foodrecord.core.flow.model.FlowNode;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class DefaultFlowValidator implements FlowValidator {
    @Override
    public Optional<String> validate(List<FlowNode> nodes) {
        // 检查开始节点
        if (nodes.stream().noneMatch(n -> "start".equals(n.getType()))) {
            return Optional.of("Flow must have a start node");
        }
        
        // 检查结束节点
        if (nodes.stream().noneMatch(n -> "end".equals(n.getType()))) {
            return Optional.of("Flow must have an end node");
        }
        
        // 检查节点连接性
        Set<String> reachableNodes = new HashSet<>();
        String startNodeId = nodes.stream()
            .filter(n -> "start".equals(n.getType()))
            .findFirst()
            .map(FlowNode::getId)
            .orElse("");
            
        checkReachability(startNodeId, nodes, reachableNodes);
        
        Set<String> allNodeIds = nodes.stream()
            .map(FlowNode::getId)
            .collect(java.util.stream.Collectors.toSet());
            
        if (!reachableNodes.containsAll(allNodeIds)) {
            return Optional.of("Some nodes are not reachable from start node");
        }
        
        return Optional.empty();
    }
    
    private void checkReachability(String nodeId, List<FlowNode> nodes, 
                                 Set<String> reachableNodes) {
        if (reachableNodes.contains(nodeId)) {
            return;
        }
        
        reachableNodes.add(nodeId);
        nodes.stream()
            .filter(n -> nodeId.equals(n.getId()))
            .findFirst()
            .ifPresent(node -> 
                node.getNextNodes().forEach(nextId -> 
                    checkReachability(nextId, nodes, reachableNodes)));
    }
} 