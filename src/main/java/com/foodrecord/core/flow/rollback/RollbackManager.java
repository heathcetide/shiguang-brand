package com.foodrecord.core.flow.rollback;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class RollbackManager {
    private static final Logger logger = LoggerFactory.getLogger(RollbackManager.class);

    private final Map<String, Deque<RollbackOperation>> rollbackStacks = new HashMap<>();
    
    public void pushRollbackOperation(String executionId, RollbackOperation operation) {
        rollbackStacks.computeIfAbsent(executionId, k -> new LinkedList<RollbackOperation>())
                     .push(operation);
    }
    
    public void executeRollback(String executionId) {
        Deque<RollbackOperation> stack = rollbackStacks.get(executionId);
        if (stack != null) {
            while (!stack.isEmpty()) {
                RollbackOperation operation = stack.pop();
                try {
                    operation.rollback();
                } catch (Exception e) {
                    // 记录回滚失败，但继续执行其他回滚操作
                    logger.error("Rollback failed for execution {}", executionId, e);
                }
            }
            rollbackStacks.remove(executionId);
        }
    }

    public void clearRollbackStack(String executionId) {
        rollbackStacks.remove(executionId);
    }

    public boolean hasRollbackOperations(String executionId) {
        Deque<RollbackOperation> stack = rollbackStacks.get(executionId);
        return stack != null && !stack.isEmpty();
    }
} 