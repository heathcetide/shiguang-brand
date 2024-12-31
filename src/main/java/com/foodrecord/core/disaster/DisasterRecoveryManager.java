package com.foodrecord.core.disaster;

import com.foodrecord.controller.user.UserController;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class DisasterRecoveryManager {

    private static final Logger logger = LoggerFactory.getLogger(UserController.class);

    private final BackupManager backupManager;
    private final RecoveryManager recoveryManager;
    private final HealthChecker healthChecker;

    public DisasterRecoveryManager(BackupManager backupManager, RecoveryManager recoveryManager, HealthChecker healthChecker) {
        this.backupManager = backupManager;
        this.recoveryManager = recoveryManager;
        this.healthChecker = healthChecker;
    }

    public void performBackup(BackupType type) {
        switch (type) {
            case FULL:
                backupManager.performFullBackup();
                break;
            case INCREMENTAL:
                backupManager.performIncrementalBackup();
                break;
        }
    }
    
    public void switchToBackupSite() {
        if (healthChecker.isPrimarySiteDown()) {
            logger.info("Switching to backup site");
            recoveryManager.activateBackupSite();
            recoveryManager.redirectTraffic();
        }
    }
    
    public void recoverFromBackup(RecoveryPoint point) {
        recoveryManager.validateBackup(point);
        recoveryManager.restoreData(point);
        recoveryManager.verifyRecovery();
    }
} 