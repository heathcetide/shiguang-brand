package com.foodrecord.core.optimization;

import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class QueryHistoryAnalyzer {
    private final SlowQueryAnalyzer slowQueryAnalyzer;
    private final IndexAnalyzer indexAnalyzer;

    public QueryHistoryAnalyzer(SlowQueryAnalyzer slowQueryAnalyzer, IndexAnalyzer indexAnalyzer) {
        this.slowQueryAnalyzer = slowQueryAnalyzer;
        this.indexAnalyzer = indexAnalyzer;
    }

    public QueryHistory analyzeHistory() {
        QueryHistory history = new QueryHistory();
        
        // 分析慢查询
        List<QueryOptimizationReport.SlowQuery> slowQueries = slowQueryAnalyzer.findSlowQueries();
        history.setSlowQueries(slowQueries);
        
        // 分析索引使用情况
        IndexUsageAnalysis indexAnalysis = indexAnalyzer.analyzeIndexUsage();
        history.setIndexAnalysis(indexAnalysis);
        
        // 计算查询模式
        Map<String, QueryPattern> patterns = analyzeQueryPatterns(slowQueries);
        history.setQueryPatterns(patterns);
        
        return history;
    }

    private Map<String, QueryPattern> analyzeQueryPatterns(List<QueryOptimizationReport.SlowQuery> queries) {
        Map<String, QueryPattern> patterns = new HashMap<>();
        
        for (QueryOptimizationReport.SlowQuery query : queries) {
            String pattern = extractQueryPattern(query.getSql());
            patterns.computeIfAbsent(pattern, k -> new QueryPattern())
                   .addQuery(query);
        }
        
        return patterns;
    }

    private String extractQueryPattern(String sql) {
        // TODO: 实现SQL模式提取逻辑
        return sql.replaceAll("\\d+", "?")
                 .replaceAll("'[^']*'", "?");
    }

    public static class QueryPattern {
        private final List<QueryOptimizationReport.SlowQuery> queries = new ArrayList<>();
        private double averageExecutionTime;
        private int frequency;

        public void addQuery(QueryOptimizationReport.SlowQuery query) {
            queries.add(query);
            updateStats(query);
        }

        private void updateStats(QueryOptimizationReport.SlowQuery query) {
            int totalQueries = queries.size();
            averageExecutionTime = (averageExecutionTime * (totalQueries - 1) + query.getExecutionTime()) / totalQueries;
            frequency += query.getFrequency();
        }

        public List<QueryOptimizationReport.SlowQuery> getQueries() {
            return queries;
        }

        public double getAverageExecutionTime() {
            return averageExecutionTime;
        }

        public int getFrequency() {
            return frequency;
        }
    }
} 