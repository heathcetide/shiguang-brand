package com.foodrecord.core.disaster;

import java.time.LocalDateTime;

public class RecoveryPoint {
    private final String backupId;
    private final LocalDateTime timestamp;
    private final BackupType backupType;

    public RecoveryPoint(String backupId, LocalDateTime timestamp, BackupType backupType) {
        this.backupId = backupId;
        this.timestamp = timestamp;
        this.backupType = backupType;
    }

    public String getBackupId() {
        return backupId;
    }

    public LocalDateTime getTimestamp() {
        return timestamp;
    }

    public BackupType getBackupType() {
        return backupType;
    }
} 