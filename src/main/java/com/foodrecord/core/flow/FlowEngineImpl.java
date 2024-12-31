package com.foodrecord.core.flow;

import com.foodrecord.core.flow.context.FlowContext;
import com.foodrecord.core.flow.event.FlowEventType;
import com.foodrecord.core.flow.executor.NodeExecutor;
import com.foodrecord.core.flow.history.FlowExecutionStatus;
import com.foodrecord.core.flow.history.NodeExecutionRecord;
import com.foodrecord.core.flow.history.NodeExecutionStatus;
import com.foodrecord.core.flow.model.FlowNode;
import com.foodrecord.core.flow.validator.FlowValidator;
import com.foodrecord.core.flow.history.FlowExecutionHistory;
import com.foodrecord.core.flow.monitor.FlowMonitor;
import com.foodrecord.core.flow.rollback.RollbackManager;
import com.foodrecord.core.flow.event.FlowEvent;
import com.foodrecord.core.flow.lock.FlowLockManager;
import com.foodrecord.core.flow.persistence.FlowExecutionRepository;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;
import java.util.*;
import java.time.LocalDateTime;
import java.util.UUID;

@Component
public class FlowEngineImpl implements FlowEngine {
    private final Map<String, List<FlowNode>> flows = new HashMap<>();
    private final NodeExecutor nodeExecutor;
    private final FlowValidator flowValidator;
    private final FlowMonitor flowMonitor;
    private final RollbackManager rollbackManager;
    private final FlowLockManager lockManager;
    private final FlowExecutionRepository executionRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final KafkaTemplate<String, FlowEvent> kafkaTemplate;
    
    public FlowEngineImpl(NodeExecutor nodeExecutor, FlowValidator flowValidator,
                          FlowMonitor flowMonitor, RollbackManager rollbackManager,
                          FlowLockManager lockManager, @Qualifier("flowExecutionRepository") FlowExecutionRepository executionRepository,
                          ApplicationEventPublisher eventPublisher, KafkaTemplate<String, FlowEvent> kafkaTemplate) {
        this.nodeExecutor = nodeExecutor;
        this.flowValidator = flowValidator;
        this.flowMonitor = flowMonitor;
        this.rollbackManager = rollbackManager;
        this.lockManager = lockManager;
        this.executionRepository = executionRepository;
        this.eventPublisher = eventPublisher;
        this.kafkaTemplate = kafkaTemplate;
    }
    
    @Override
    public void registerFlow(String flowId, List<FlowNode> nodes) {
        flowValidator.validate(nodes)
            .ifPresent(error -> {
                throw new IllegalArgumentException("Invalid flow: " + error);
            });
        flows.put(flowId, nodes);
    }
    
    @Override
    public void executeFlow(String flowId, Map<String, Object> context) {
        String executionId = UUID.randomUUID().toString();
        
        if (!lockManager.acquireLock(flowId, executionId)) {
            throw new IllegalStateException("Flow is already running: " + flowId);
        }
        
        try {
            FlowExecutionHistory history = new FlowExecutionHistory();
            history.setFlowId(flowId);
            history.setExecutionId(executionId);
            history.setStartTime(LocalDateTime.now());
            
            long startTime = System.currentTimeMillis();
            boolean success = false;
            
            try {
                List<FlowNode> nodes = flows.get(flowId);
                if (nodes == null) {
                    throw new IllegalArgumentException("Flow not found: " + flowId);
                }
                
                FlowContext flowContext = new FlowContext();
                flowContext.setFlowId(flowId);
                flowContext.setVariables(context);
                
                FlowNode startNode = nodes.stream()
                    .filter(n -> "start".equals(n.getType()))
                    .findFirst()
                    .orElseThrow(() -> new IllegalStateException("Start node not found"));
                
                executeNode(startNode, nodes, flowContext, executionId);
                success = true;
            } catch (Exception e) {
                history.setErrorMessage(e.getMessage());
                rollbackManager.executeRollback(executionId);
                throw e;
            } finally {
                long duration = System.currentTimeMillis() - startTime;
                history.setEndTime(LocalDateTime.now());
                history.setStatus(success ? FlowExecutionStatus.COMPLETED : FlowExecutionStatus.FAILED);
                flowMonitor.recordExecution(flowId, duration, success);
                saveExecutionHistory(history);
            }
            
            publishEvent(FlowEvent.of(flowId, executionId, null, FlowEventType.FLOW_COMPLETED));
            
        } finally {
            lockManager.releaseLock(flowId, executionId);
        }
    }

    @Override
    public void stopFlow(String flowId) {
        // TODO: 实现流程停止逻辑
    }

    @Override
    public void pauseFlow(String flowId) {
        // TODO: 实现流程暂停逻辑
    }

    @Override
    public void resumeFlow(String flowId) {
        // TODO: 实现流程恢复逻辑
    }

    @Override
    public boolean isFlowRunning(String flowId) {
        return lockManager.isLocked(flowId);
    }

    @Override
    public Map<String, Object> getFlowStatus(String flowId) {
        // TODO: 实现获取流程状态逻辑
        return new HashMap<>();
    }
    
    private void executeNode(FlowNode node, List<FlowNode> nodes, 
                           FlowContext context, String executionId) {
        NodeExecutionRecord record = new NodeExecutionRecord();
        record.setNodeId(node.getId());
        record.setNodeType(node.getType());
        record.setStartTime(LocalDateTime.now());
        record.setInputVariables(new HashMap<>(context.getVariables()));
        
        try {
            nodeExecutor.execute(node, context.getVariables());
            record.setStatus(NodeExecutionStatus.COMPLETED);
        } catch (Exception e) {
            record.setStatus(NodeExecutionStatus.FAILED);
            record.setErrorMessage(e.getMessage());
            throw e;
        } finally {
            record.setEndTime(LocalDateTime.now());
            record.setOutputVariables(new HashMap<>(context.getVariables()));
            saveNodeExecutionRecord(executionId, record);
        }
    }
    
    private FlowNode findNode(String nodeId, List<FlowNode> nodes) {
        return nodes.stream()
            .filter(n -> nodeId.equals(n.getId()))
            .findFirst()
            .orElseThrow(() -> new IllegalStateException("Node not found: " + nodeId));
    }
    
    private void publishEvent(FlowEvent event) {
        eventPublisher.publishEvent(event);
        kafkaTemplate.send("flow-events", event);
    }

    private void saveExecutionHistory(FlowExecutionHistory history) {
        executionRepository.save(history);
    }

    private void saveNodeExecutionRecord(String executionId, NodeExecutionRecord record) {
        executionRepository.saveNodeRecord(executionId, record);
    }
} 