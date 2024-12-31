package com.foodrecord.core.flow.persistence;

import com.foodrecord.core.flow.history.FlowExecutionHistory;
import com.foodrecord.core.flow.history.NodeExecutionRecord;
import org.springframework.data.domain.Example;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public class FlowExecutionRepositoryImpl implements FlowExecutionRepository {
    private final MongoTemplate mongoTemplate;

    public FlowExecutionRepositoryImpl(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    @Override
    public List<FlowExecutionHistory> findByFlowId(String flowId) {
        Query query = new Query(Criteria.where("flowId").is(flowId));
        return mongoTemplate.find(query, FlowExecutionHistory.class);
    }

    @Override
    public Optional<FlowExecutionHistory> findByExecutionId(String executionId) {
        Query query = new Query(Criteria.where("executionId").is(executionId));
        FlowExecutionHistory history = mongoTemplate.findOne(query, FlowExecutionHistory.class);
        return Optional.ofNullable(history);
    }

    @Override
    public void saveNodeRecord(String executionId, NodeExecutionRecord record) {
        Query query = new Query(Criteria.where("executionId").is(executionId));
        Update update = new Update().push("nodeRecords", record);
        mongoTemplate.updateFirst(query, update, FlowExecutionHistory.class);
    }

    @Override
    public List<NodeExecutionRecord> getNodeRecords(String executionId) {
        Query query = new Query(Criteria.where("executionId").is(executionId));
        FlowExecutionHistory history = mongoTemplate.findOne(query, FlowExecutionHistory.class);
        return history != null ? history.getNodeRecords() : List.of();
    }

    @Override
    public void deleteByFlowId(String flowId) {
        Query query = new Query(Criteria.where("flowId").is(flowId));
        mongoTemplate.remove(query, FlowExecutionHistory.class);
    }

    @Override
    public void deleteByExecutionId(String executionId) {
        Query query = new Query(Criteria.where("executionId").is(executionId));
        mongoTemplate.remove(query, FlowExecutionHistory.class);
    }

    @Override
    public <S extends FlowExecutionHistory> S save(S entity) {
        return mongoTemplate.save(entity);
    }

    @Override
    public <S extends FlowExecutionHistory> List<S> saveAll(Iterable<S> entities) {
//        return entities.stream().map(this::save).toList();
        return null;
    }

    @Override
    public Optional<FlowExecutionHistory> findById(String id) {
        return Optional.ofNullable(mongoTemplate.findById(id, FlowExecutionHistory.class));
    }

    @Override
    public boolean existsById(String id) {
        return findById(id).isPresent();
    }

    @Override
    public List<FlowExecutionHistory> findAll() {
        return mongoTemplate.findAll(FlowExecutionHistory.class);
    }

    @Override
    public List<FlowExecutionHistory> findAll(Sort sort) {
        return List.of();
    }

    @Override
    public Page<FlowExecutionHistory> findAll(Pageable pageable) {
        return null;
    }

    @Override
    public <S extends FlowExecutionHistory> S insert(S s) {
        return null;
    }

    @Override
    public <S extends FlowExecutionHistory> List<S> insert(Iterable<S> iterable) {
        return List.of();
    }

    @Override
    public <S extends FlowExecutionHistory> Optional<S> findOne(Example<S> example) {
        return Optional.empty();
    }

    @Override
    public <S extends FlowExecutionHistory> List<S> findAll(Example<S> example) {
        return List.of();
    }

    @Override
    public <S extends FlowExecutionHistory> List<S> findAll(Example<S> example, Sort sort) {
        return List.of();
    }

    @Override
    public <S extends FlowExecutionHistory> Page<S> findAll(Example<S> example, Pageable pageable) {
        return null;
    }

    @Override
    public <S extends FlowExecutionHistory> long count(Example<S> example) {
        return 0;
    }

    @Override
    public <S extends FlowExecutionHistory> boolean exists(Example<S> example) {
        return false;
    }

    @Override
    public Iterable<FlowExecutionHistory> findAllById(Iterable<String> ids) {
        Query query = new Query(Criteria.where("_id").in(ids));
        return mongoTemplate.find(query, FlowExecutionHistory.class);
    }

    @Override
    public long count() {
        return mongoTemplate.count(new Query(), FlowExecutionHistory.class);
    }

    @Override
    public void deleteById(String id) {
        Query query = new Query(Criteria.where("_id").is(id));
        mongoTemplate.remove(query, FlowExecutionHistory.class);
    }

    @Override
    public void delete(FlowExecutionHistory entity) {
        mongoTemplate.remove(entity);
    }

    public void deleteAllById(Iterable<? extends String> ids) {
        Query query = new Query(Criteria.where("_id").in(ids));
        mongoTemplate.remove(query, FlowExecutionHistory.class);
    }

    @Override
    public void deleteAll(Iterable<? extends FlowExecutionHistory> entities) {
        entities.forEach(this::delete);
    }

    @Override
    public void deleteAll() {
        mongoTemplate.remove(new Query(), FlowExecutionHistory.class);
    }
} 