package com.foodrecord.core.flow.rollback;

@FunctionalInterface
public interface RollbackOperation {
    void rollback() throws Exception;
} 