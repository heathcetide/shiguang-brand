package com.foodrecord.core.disaster;

public class DatabaseBackup {
    private final String backupPath;
    private final long size;
    private final String checksum;

    public DatabaseBackup(String backupPath, long size, String checksum) {
        this.backupPath = backupPath;
        this.size = size;
        this.checksum = checksum;
    }

    public String getBackupPath() {
        return backupPath;
    }

    public long getSize() {
        return size;
    }

    public String getChecksum() {
        return checksum;
    }
} 