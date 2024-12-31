package com.foodrecord.core.optimization;

import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class QueryOptimizer {
    protected final SlowQueryAnalyzer slowQueryAnalyzer;
    protected final IndexAnalyzer indexAnalyzer;
    protected final QueryPlanOptimizer queryPlanOptimizer;

    public QueryOptimizer() {
        this.slowQueryAnalyzer = new SlowQueryAnalyzer();
        this.indexAnalyzer = new IndexAnalyzer();
        this.queryPlanOptimizer = new QueryPlanOptimizer(new CacheOptimizer(), new ThreadPoolOptimizer());
    }

    public QueryOptimizer(SlowQueryAnalyzer slowQueryAnalyzer, IndexAnalyzer indexAnalyzer, QueryPlanOptimizer queryPlanOptimizer) {
        this.slowQueryAnalyzer = slowQueryAnalyzer;
        this.indexAnalyzer = indexAnalyzer;
        this.queryPlanOptimizer = queryPlanOptimizer;
    }

    public OptimizationReport analyzeAndOptimize() {
        OptimizationReport report = new OptimizationReport();
        
        // 分析慢查询
        List<QueryOptimizationReport.SlowQuery> slowQueries = slowQueryAnalyzer.findSlowQueries();
        report.getQueryAnalysis().setSlowQueries(slowQueries);
        
        // 分析索引使用情况
        IndexUsageAnalysis indexAnalysis = indexAnalyzer.analyzeIndexUsage();
        
        // 优化查询计划
        for (QueryOptimizationReport.SlowQuery query : slowQueries) {
            QueryPlan optimizedPlan = queryPlanOptimizer.optimize(query);
            report.getQueryAnalysis().addQueryMetric("optimizedTime." + query.getSql(), optimizedPlan.getEstimatedCost());
        }
        
        // 生成优化建议
        List<String> suggestions = generateSuggestions(slowQueries, indexAnalysis);
        report.getQueryAnalysis().setSuggestions(suggestions);
        
        return report;
    }

    public OptimizationReport.QueryAnalysis analyzeSlowQueries() {
        OptimizationReport.QueryAnalysis analysis = new OptimizationReport.QueryAnalysis();
        
        // 获取慢查询列表
        List<QueryOptimizationReport.SlowQuery> slowQueries = slowQueryAnalyzer.findSlowQueries();
        analysis.setSlowQueries(slowQueries);
        
        // 分析每个慢查询的性能指标
        for (QueryOptimizationReport.SlowQuery query : slowQueries) {
            double avgExecutionTime = query.getExecutionTime();
            analysis.addQueryMetric(query.getSql(), avgExecutionTime);
        }
        
        return analysis;
    }

    public void optimizeSlowQueries() {
        // 获取慢查询列表
        List<QueryOptimizationReport.SlowQuery> slowQueries = slowQueryAnalyzer.findSlowQueries();
        
        // 优化每个慢查询
        for (QueryOptimizationReport.SlowQuery query : slowQueries) {
            // 生成优化后的查询计划
            QueryPlan optimizedPlan = queryPlanOptimizer.optimize(query);
            
            // 应用优化建议
            if (optimizedPlan.hasOptimizations()) {
                applyOptimizations(optimizedPlan);
            }
        }
    }

    private void applyOptimizations(QueryPlan plan) {
        // TODO: 实现优化应用逻辑
    }

    protected List<String> generateSuggestions(List<QueryOptimizationReport.SlowQuery> slowQueries, IndexUsageAnalysis indexAnalysis) {
        List<String> suggestions = new ArrayList<>();
        
        // 分析慢查询
        for (QueryOptimizationReport.SlowQuery query : slowQueries) {
            // 检查执行时间
            if (query.getExecutionTime() > 1000) {
                suggestions.add("Query execution time exceeds 1 second: " + query.getSql());
            }
        }
        
        // 分析索引使用情况
        for (String unusedIndex : indexAnalysis.getUnusedIndexes()) {
            suggestions.add("Consider removing unused index: " + unusedIndex);
        }
        
        for (String suggestedIndex : indexAnalysis.getSuggestedIndexes()) {
            suggestions.add("Consider adding index: " + suggestedIndex);
        }
        
        return suggestions;
    }

    public List<String> getOptimizationSuggestions() {
        List<QueryOptimizationReport.SlowQuery> slowQueries = slowQueryAnalyzer.findSlowQueries();
        IndexUsageAnalysis indexAnalysis = indexAnalyzer.analyzeIndexUsage();
        return generateSuggestions(slowQueries, indexAnalysis);
    }
} 