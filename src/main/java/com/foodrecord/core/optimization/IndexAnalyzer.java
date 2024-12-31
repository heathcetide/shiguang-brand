package com.foodrecord.core.optimization;

import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class IndexAnalyzer {
    private final Map<String, IndexStats> indexStats;
    private final double usageThreshold;

    public IndexAnalyzer() {
        this(0.1); // 默认使用率阈值为10%
    }

    public IndexAnalyzer(double usageThreshold) {
        this.indexStats = new HashMap<>();
        this.usageThreshold = usageThreshold;
    }

    public IndexUsageAnalysis analyzeIndexUsage() {
        IndexUsageAnalysis analysis = new IndexUsageAnalysis();
        
        // 分析每个索引的使用情况
        for (Map.Entry<String, IndexStats> entry : indexStats.entrySet()) {
            String indexName = entry.getKey();
            IndexStats stats = entry.getValue();
            
            // 检查未使用的索引
            if (stats.getUsageCount() == 0) {
                analysis.addUnusedIndex(indexName);
            }
            
            // 记录索引使用次数
            analysis.recordIndexUsage(indexName, stats.getUsageCount());
            
            // 记录索引效率
            analysis.recordIndexEfficiency(indexName, stats.getEfficiency());
        }
        
        // 分析可能需要的索引
        for (String suggestedIndex : analyzeSuggestedIndexes()) {
            analysis.addSuggestedIndex(suggestedIndex);
        }
        
        return analysis;
    }

    public void recordIndexUsage(String indexName, long queryTime, int rowsScanned) {
        indexStats.computeIfAbsent(indexName, k -> new IndexStats())
                 .recordUsage(queryTime, rowsScanned);
    }

    private Set<String> analyzeSuggestedIndexes() {
        // TODO: 实现索引建议分析逻辑
        return new HashSet<>();
    }

    private static class IndexStats {
        private int usageCount;
        private long totalQueryTime;
        private long totalRowsScanned;

        public void recordUsage(long queryTime, int rowsScanned) {
            usageCount++;
            totalQueryTime += queryTime;
            totalRowsScanned += rowsScanned;
        }

        public int getUsageCount() {
            return usageCount;
        }

        public double getEfficiency() {
            if (totalRowsScanned == 0) {
                return 0.0;
            }
            return 1.0 - ((double) totalQueryTime / totalRowsScanned);
        }
    }
} 