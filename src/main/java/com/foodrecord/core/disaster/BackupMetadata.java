package com.foodrecord.core.disaster;

import java.time.LocalDateTime;

public class BackupMetadata {
    private final String backupId;
    private final BackupType type;
    private final LocalDateTime timestamp;

    public BackupMetadata(String backupId, BackupType type, LocalDateTime timestamp) {
        this.backupId = backupId;
        this.type = type;
        this.timestamp = timestamp;
    }

    public String getBackupId() {
        return backupId;
    }

    public BackupType getType() {
        return type;
    }

    public LocalDateTime getTimestamp() {
        return timestamp;
    }
} 