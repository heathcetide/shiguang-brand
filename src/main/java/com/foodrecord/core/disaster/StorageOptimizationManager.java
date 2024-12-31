package com.foodrecord.core.disaster;

import com.foodrecord.core.disaster.storage.analysis.*;
import com.foodrecord.core.disaster.storage.optimization.*;
import org.springframework.stereotype.Component;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class StorageOptimizationManager {
    private final CompressionOptimizer compressionOptimizer;
    private final DedupEngine dedupEngine;
    private final StorageAnalyzer storageAnalyzer;
    
    public StorageOptimizationManager(
            CompressionOptimizer compressionOptimizer,
            DedupEngine dedupEngine,
            StorageAnalyzer storageAnalyzer) {
        this.compressionOptimizer = compressionOptimizer;
        this.dedupEngine = dedupEngine;
        this.storageAnalyzer = storageAnalyzer;
    }
    
    public StorageOptimizationPlan optimizeStorage(BackupMetadata metadata) {
        // 1. 分析存储特征
        StorageCharacteristics characteristics = 
            storageAnalyzer.analyzeStorage(metadata);
            
        // 2. 生成优化计划
        StorageOptimizationPlan plan = new StorageOptimizationPlan();
        
        // 3. 优化压缩策略
        if (characteristics.isCompressible()) {
            CompressionStrategy strategy = 
                compressionOptimizer.determineOptimalStrategy(characteristics);
            plan.setCompressionStrategy(strategy);
        }
        
        // 4. 应用重复数据删除
        if (characteristics.hasDuplicateData()) {
            DedupStrategy dedupStrategy = 
                dedupEngine.createStrategy(characteristics);
            plan.setDedupStrategy(dedupStrategy);
        }
        
        return plan;
    }
} 