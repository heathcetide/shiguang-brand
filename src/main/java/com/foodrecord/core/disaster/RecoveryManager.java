package com.foodrecord.core.disaster;

import org.springframework.stereotype.Service;

public interface RecoveryManager {
    void validateBackup(RecoveryPoint point);
    void restoreData(RecoveryPoint point);
    void verifyRecovery();
    void activateBackupSite();
    void redirectTraffic();
} 