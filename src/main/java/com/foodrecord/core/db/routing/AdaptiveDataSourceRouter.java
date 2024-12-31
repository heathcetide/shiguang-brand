package com.foodrecord.core.db.routing;

import com.foodrecord.common.monitor.PerformanceMonitor;
import com.foodrecord.core.db.routing.analysis.LoadPredictor;
import com.foodrecord.core.db.routing.analysis.QueryPatternAnalyzer;
import com.foodrecord.core.db.routing.query.*;
import com.foodrecord.core.db.routing.scoring.DataSourceScorer;
import com.foodrecord.core.flow.performance.PerformanceMetrics;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.transaction.reactive.TransactionContext;

import javax.sql.DataSource;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
public class AdaptiveDataSourceRouter extends ReadWriteDataSourceRouter {
    private final PerformanceMonitor performanceMonitor;
    private final LoadPredictor loadPredictor;
    private final QueryPatternAnalyzer queryAnalyzer;

    public AdaptiveDataSourceRouter(List<DataSource> slaveDataSources, 
                                  DataSource masterDataSource,
                                  LoadBalanceStrategy loadBalanceStrategy,
                                  PerformanceMonitor performanceMonitor,
                                  LoadPredictor loadPredictor,
                                    @Qualifier("queryPatternAnalyzer") QueryPatternAnalyzer queryAnalyzer) {
        super(slaveDataSources, masterDataSource, loadBalanceStrategy);
        this.performanceMonitor = performanceMonitor;
        this.loadPredictor = loadPredictor;
        this.queryAnalyzer = queryAnalyzer;
    }

    @Override
    protected DataSource determineReadDataSource(TransactionContext context) {
        String sql = getSqlFromContext(context);
        if (sql == null) {
            return super.determineReadDataSource(context);
        }

        // 1. 分析查询特征
        QueryCharacteristics queryChars = queryAnalyzer.analyze(sql);
        
        // 2. 预测负载影响
        LoadImpact impact = loadPredictor.predictImpact(queryChars);
        
        // 3. 获取数据源性能指标
        Map<DataSource, PerformanceMetrics> metrics = performanceMonitor.getCurrentMetrics();
        
        // 4. 智能选择数据源
        return selectOptimalDataSource(queryChars, impact, metrics);
    }
    
    private DataSource selectOptimalDataSource(
            QueryCharacteristics queryChars,
            LoadImpact impact,
            Map<DataSource, PerformanceMetrics> metrics) {
            
        // 构建评分器
        DataSourceScorer scorer = new DataSourceScorer()
            .withQueryCharacteristics(queryChars)
            .withLoadImpact(impact)
            .withPerformanceMetrics(metrics);
            
        // 评分并选择最优数据源
        return scorer.selectBest();
    }

    public static class QueryCharacteristics {
        private final QueryComplexity complexity;
        private final ResourceRequirements resources;
        private final DataAccessPattern accessPattern;
        private final Set<String> tables;
        private final EstimatedExecutionTime estimatedTime;

        public QueryCharacteristics(QueryComplexity complexity,
                                  ResourceRequirements resources,
                                  DataAccessPattern accessPattern,
                                  Set<String> tables,
                                  EstimatedExecutionTime estimatedTime) {
            this.complexity = complexity;
            this.resources = resources;
            this.accessPattern = accessPattern;
            this.tables = tables;
            this.estimatedTime = estimatedTime;
        }

        public QueryComplexity getComplexity() {
            return complexity;
        }

        public ResourceRequirements getResources() {
            return resources;
        }

        public DataAccessPattern getAccessPattern() {
            return accessPattern;
        }

        public Set<String> getTables() {
            return tables;
        }

        public EstimatedExecutionTime getEstimatedTime() {
            return estimatedTime;
        }
    }

    public static class LoadImpact {
        private final double cpuImpact;
        private final double memoryImpact;
        private final double ioImpact;
        private final int estimatedConcurrentQueries;
        private final Duration estimatedDuration;

        public LoadImpact(double cpuImpact, double memoryImpact, double ioImpact,
                         int estimatedConcurrentQueries, Duration estimatedDuration) {
            this.cpuImpact = cpuImpact;
            this.memoryImpact = memoryImpact;
            this.ioImpact = ioImpact;
            this.estimatedConcurrentQueries = estimatedConcurrentQueries;
            this.estimatedDuration = estimatedDuration;
        }

        public double getCpuImpact() {
            return cpuImpact;
        }

        public double getMemoryImpact() {
            return memoryImpact;
        }

        public double getIoImpact() {
            return ioImpact;
        }

        public int getEstimatedConcurrentQueries() {
            return estimatedConcurrentQueries;
        }

        public Duration getEstimatedDuration() {
            return estimatedDuration;
        }
    }
} 