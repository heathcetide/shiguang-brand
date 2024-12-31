package com.foodrecord.core.db.routing;

import org.springframework.stereotype.Component;
import org.springframework.transaction.reactive.TransactionContext;

import javax.sql.DataSource;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

@Component
public class ReadWriteDataSourceRouter {
    private final List<DataSource> slaveDataSources;
    private final DataSource masterDataSource;
    private final AtomicInteger counter = new AtomicInteger(0);
    private final LoadBalanceStrategy loadBalanceStrategy;
    private final Map<String, DataSourceStats> dataSourceStats = new ConcurrentHashMap<>();
    private final Random random = new Random();

    public ReadWriteDataSourceRouter(List<DataSource> slaveDataSources, DataSource masterDataSource, LoadBalanceStrategy loadBalanceStrategy) {
        this.slaveDataSources = slaveDataSources;
        this.masterDataSource = masterDataSource;
        this.loadBalanceStrategy = loadBalanceStrategy;
        initializeDataSourceStats();
    }

    private void initializeDataSourceStats() {
        for (int i = 0; i < slaveDataSources.size(); i++) {
            dataSourceStats.put("slave-" + i, new DataSourceStats("slave-" + i));
        }
    }

    public DataSource determineDataSource(TransactionContext context) {
        if (isWriteOperation(context)) {
            return masterDataSource;
        }
        
        return determineReadDataSource(context);
    }
    
    DataSource determineReadDataSource(TransactionContext context) {
        switch (loadBalanceStrategy) {
            case ROUND_ROBIN:
                return getRoundRobinDataSource();
            case LEAST_CONNECTIONS:
                return getLeastConnectionsDataSource();
            case WEIGHTED_RANDOM:
                return getWeightedRandomDataSource();
            case RANDOM:
                return getRandomDataSource();
            default:
                return slaveDataSources.get(0);
        }
    }
    
    private boolean isWriteOperation(TransactionContext context) {
        if (context == null) {
            return false;
        }
        
        String sql = getSqlFromContext(context);
        if (sql == null) {
            return false;
        }
        
        sql = sql.toUpperCase();
        return sql.startsWith("INSERT") || 
               sql.startsWith("UPDATE") || 
               sql.startsWith("DELETE");
    }

    String getSqlFromContext(TransactionContext context) {
        // 从事务上下文中获取SQL语句的实现
        return null;
    }

    private DataSource getRoundRobinDataSource() {
        int index = counter.getAndIncrement() % slaveDataSources.size();
        return slaveDataSources.get(index);
    }

    private DataSource getLeastConnectionsDataSource() {
        int minConnections = Integer.MAX_VALUE;
        DataSource selectedDataSource = slaveDataSources.get(0);

        for (int i = 0; i < slaveDataSources.size(); i++) {
            DataSourceStats stats = dataSourceStats.get("slave-" + i);
            if (stats.isAvailable() && stats.getActiveConnections().get() < minConnections) {
                minConnections = stats.getActiveConnections().get();
                selectedDataSource = slaveDataSources.get(i);
            }
        }

        return selectedDataSource;
    }

    private DataSource getWeightedRandomDataSource() {
        // 基于权重的随机选择实现
        return slaveDataSources.get(random.nextInt(slaveDataSources.size()));
    }

    private DataSource getRandomDataSource() {
        return slaveDataSources.get(random.nextInt(slaveDataSources.size()));
    }

    public static class DataSourceStats {
        private final String id;
        private final AtomicInteger activeConnections = new AtomicInteger(0);
        private final AtomicInteger totalConnections = new AtomicInteger(0);
        private volatile long lastResponseTime;
        private volatile boolean available = true;
        private static final long RESPONSE_TIME_THRESHOLD = 1000; // 1秒
        private final AtomicInteger slowResponseCount = new AtomicInteger(0);

        public DataSourceStats(String id) {
            this.id = id;
        }

        public String getId() {
            return id;
        }

        public AtomicInteger getActiveConnections() {
            return activeConnections;
        }

        public AtomicInteger getTotalConnections() {
            return totalConnections;
        }

        public long getLastResponseTime() {
            return lastResponseTime;
        }

        public void setLastResponseTime(long lastResponseTime) {
            this.lastResponseTime = lastResponseTime;
        }

        public boolean isAvailable() {
            return available;
        }

        public void setAvailable(boolean available) {
            this.available = available;
        }

        public void recordResponse(long responseTime) {
            this.lastResponseTime = responseTime;
            if (responseTime > RESPONSE_TIME_THRESHOLD) {
                markSlowResponse();
            }
        }

        public void markSlowResponse() {
            int count = slowResponseCount.incrementAndGet();
            if (count > 10) { // 如果连续10次响应慢，则标记为不可用
                setAvailable(false);
            }
        }

        public void resetSlowResponseCount() {
            slowResponseCount.set(0);
            setAvailable(true);
        }
    }
} 