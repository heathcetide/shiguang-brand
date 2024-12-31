package com.foodrecord.core.flow.persistence;

import com.foodrecord.core.flow.history.FlowExecutionHistory;
import com.foodrecord.core.flow.history.NodeExecutionRecord;
import org.springframework.stereotype.Repository;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
import java.util.Optional;

@Repository
public interface FlowExecutionRepository extends MongoRepository<FlowExecutionHistory, String> {
    List<FlowExecutionHistory> findByFlowId(String flowId);
    Optional<FlowExecutionHistory> findByExecutionId(String executionId);
    void saveNodeRecord(String executionId, NodeExecutionRecord record);
    List<NodeExecutionRecord> getNodeRecords(String executionId);
    void deleteByFlowId(String flowId);
    void deleteByExecutionId(String executionId);
} 