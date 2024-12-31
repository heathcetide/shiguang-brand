package com.foodrecord.core.flow.executor;

import org.springframework.stereotype.Component;
import com.foodrecord.core.flow.model.FlowNode;
import java.util.Map;

@Component
public class DefaultNodeExecutor implements NodeExecutor {
    @Override
    public void execute(FlowNode node, Map<String, Object> context) {
        // 默认节点执行逻辑
        String nodeType = node.getType();
        switch (nodeType) {
            case "start":
                executeStartNode(node, context);
                break;
            case "end":
                executeEndNode(node, context);
                break;
            case "task":
                executeTaskNode(node, context);
                break;
            default:
                throw new IllegalArgumentException("Unsupported node type: " + nodeType);
        }
    }

    @Override
    public boolean canExecute(FlowNode node) {
        return true;
    }

    private void executeStartNode(FlowNode node, Map<String, Object> context) {
        // 开始节点逻辑
    }

    private void executeEndNode(FlowNode node, Map<String, Object> context) {
        // 结束节点逻辑
    }

    private void executeTaskNode(FlowNode node, Map<String, Object> context) {
        // 任务节点逻辑
    }
} 