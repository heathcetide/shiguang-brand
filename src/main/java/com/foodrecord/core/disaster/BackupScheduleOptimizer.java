package com.foodrecord.core.disaster;

import org.springframework.stereotype.Service;

@Service
public interface BackupScheduleOptimizer {
    void optimize(BackupManager.BackupResult result);
} 