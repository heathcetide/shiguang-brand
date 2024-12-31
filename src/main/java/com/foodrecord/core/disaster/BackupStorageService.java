package com.foodrecord.core.disaster;

import org.springframework.stereotype.Service;

public interface BackupStorageService {
    void store(BackupMetadata metadata, DatabaseBackup dbBackup, FileSystemBackup fsBackup);
} 