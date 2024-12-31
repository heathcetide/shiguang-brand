package com.foodrecord.core.optimization;

import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class SlowQueryAnalyzer {
    private final long slowQueryThreshold;
    private final Map<String, QueryStats> queryStats;

    public SlowQueryAnalyzer() {
        this(1000); // 默认慢查询阈值为1秒
    }

    public SlowQueryAnalyzer(long slowQueryThreshold) {
        this.slowQueryThreshold = slowQueryThreshold;
        this.queryStats = new HashMap<>();
    }

    public List<QueryOptimizationReport.SlowQuery> findSlowQueries() {
        List<QueryOptimizationReport.SlowQuery> slowQueries = new ArrayList<>();
        
        for (Map.Entry<String, QueryStats> entry : queryStats.entrySet()) {
            QueryStats stats = entry.getValue();
            if (stats.getAverageExecutionTime() > slowQueryThreshold) {
                slowQueries.add(new QueryOptimizationReport.SlowQuery(
                    entry.getKey(),
                    stats.getAverageExecutionTime(),
                    stats.getExecutionCount()
                ));
            }
        }
        
        return slowQueries;
    }

    public void recordQueryExecution(String sql, long executionTime) {
        queryStats.computeIfAbsent(sql, k -> new QueryStats())
                 .recordExecution(executionTime);
    }

    private static class QueryStats {
        private long totalExecutionTime;
        private int executionCount;

        public void recordExecution(long executionTime) {
            totalExecutionTime += executionTime;
            executionCount++;
        }

        public long getAverageExecutionTime() {
            return executionCount > 0 ? totalExecutionTime / executionCount : 0;
        }

        public int getExecutionCount() {
            return executionCount;
        }
    }
} 