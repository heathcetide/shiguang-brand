package com.foodrecord.core.disaster;

import org.springframework.stereotype.Service;

public interface HealthChecker {
    boolean isPrimarySiteDown();
    boolean isBackupSiteReady();
    void checkSystemHealth();
} 