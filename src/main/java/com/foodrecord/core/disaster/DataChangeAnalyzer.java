package com.foodrecord.core.disaster;

import org.springframework.stereotype.Service;

@Service
public interface DataChangeAnalyzer {
    IntelligentBackupManager.ChangeAnalysis analyzeChanges();
} 