package com.foodrecord.core.disaster;

import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Random;

@Service
public class DataChangeAnalyzerImpl implements DataChangeAnalyzer {

    @Override
    public IntelligentBackupManager.ChangeAnalysis analyzeChanges() {
        // 模拟数据变化分析逻辑
        IntelligentBackupManager.ChangeAnalysis analysis = new IntelligentBackupManager.ChangeAnalysis(1L,null,0.0,null,null);

//        // 设置模拟的变化数据
//        analysis.setChangedRecordsCount(getRandomCount(500, 1000));
//        analysis.setAffectedTablesCount(getRandomCount(5, 20));
//        analysis.setCriticalChanges(getRandomCount(1, 5));
//        analysis.setLastChangeTime(LocalDateTime.now().minusMinutes(getRandomCount(1, 60)));
//        analysis.setAnalysisTime(LocalDateTime.now());
//
//        // 模拟重要变化的占比
//        analysis.setCriticalChangeRate(analysis.getCriticalChanges() * 100.0 / analysis.getChangedRecordsCount());

        System.out.println("Data change analysis completed.");
        return analysis;
    }

    private int getRandomCount(int min, int max) {
        return new Random().nextInt(max - min + 1) + min;
    }
}
