package com.foodrecord.core.disaster;

import com.foodrecord.controller.user.UserController;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.CompletableFuture;

@Component
public class BackupManager {
    private static final Logger logger = LoggerFactory.getLogger(UserController.class);
    private final DatabaseBackupService dbBackupService;
    private final FileSystemBackupService fsBackupService;
    private final BackupStorageService storageService;
    private final BackupVerificationService verificationService;

    public BackupManager(
        DatabaseBackupService dbBackupService,
        FileSystemBackupService fsBackupService,
        BackupStorageService storageService,
        BackupVerificationService verificationService
    ) {
        this.dbBackupService = dbBackupService;
        this.fsBackupService = fsBackupService;
        this.storageService = storageService;
        this.verificationService = verificationService;
    }

    private String generateBackupId() {
        return UUID.randomUUID().toString();
    }
    
    public CompletableFuture<BackupResult> performFullBackup() {
        String backupId = generateBackupId();
        logger.info("Starting full backup: {}", backupId);
        
        return CompletableFuture.supplyAsync(() -> {
            try {
                // 数据库备份
                DatabaseBackup dbBackup = dbBackupService.backup();
                
                // 文件系统备份
                FileSystemBackup fsBackup = fsBackupService.backup();
                
                // 存储备份
                BackupMetadata metadata = new BackupMetadata(backupId, 
                    BackupType.FULL, LocalDateTime.now());
                storageService.store(metadata, dbBackup, fsBackup);
                
                // 验证备份
                boolean isValid = verificationService.verifyBackup(backupId);
                if (!isValid) {
                    throw new BackupVerificationException("Backup verification failed");
                }
                
                Map<String, String> checksums = new HashMap<>();
                checksums.put("database", dbBackup.getChecksum());
                checksums.put("filesystem", fsBackup.getChecksum());
                
                return new BackupResult(
                    backupId,
                    true,
                    null,
                    LocalDateTime.now(),
                    dbBackup.getSize() + fsBackup.getSize(),
                    checksums
                );
            } catch (Exception e) {
                logger.error("Backup failed", e);
                return new BackupResult(
                    backupId,
                    false,
                    e.getMessage(),
                    LocalDateTime.now(),
                    0L,
                    Collections.emptyMap()
                );
            }
        });
    }

    public CompletableFuture<BackupResult> performIncrementalBackup() {
        String backupId = generateBackupId();
        logger.info("Starting incremental backup: {}", backupId);
        
        return CompletableFuture.supplyAsync(() -> {
            try {
                // 数据库增量备份
                DatabaseBackup dbBackup = dbBackupService.backup();
                
                // 文件系统增量备份
                FileSystemBackup fsBackup = fsBackupService.backup();
                
                // 存储备份
                BackupMetadata metadata = new BackupMetadata(backupId, 
                    BackupType.INCREMENTAL, LocalDateTime.now());
                storageService.store(metadata, dbBackup, fsBackup);
                
                // 验证备份
                boolean isValid = verificationService.verifyBackup(backupId);
                if (!isValid) {
                    throw new BackupVerificationException("Backup verification failed");
                }
                
                Map<String, String> checksums = new HashMap<>();
                checksums.put("database", dbBackup.getChecksum());
                checksums.put("filesystem", fsBackup.getChecksum());
                
                return new BackupResult(
                    backupId,
                    true,
                    null,
                    LocalDateTime.now(),
                    dbBackup.getSize() + fsBackup.getSize(),
                    checksums
                );
            } catch (Exception e) {
                logger.error("Incremental backup failed", e);
                return new BackupResult(
                    backupId,
                    false,
                    e.getMessage(),
                    LocalDateTime.now(),
                    0L,
                    Collections.emptyMap()
                );
            }
        });
    }

    public static class BackupResult {
        private final String backupId;
        private final boolean success;
        private final String errorMessage;
        private final LocalDateTime completionTime;
        private final long backupSize;
        private final Map<String, String> checksums;

        public BackupResult(String backupId, boolean success, String errorMessage, LocalDateTime completionTime, long backupSize, Map<String, String> checksums) {
            this.backupId = backupId;
            this.success = success;
            this.errorMessage = errorMessage;
            this.completionTime = completionTime;
            this.backupSize = backupSize;
            this.checksums = checksums;
        }

        public String getBackupId() {
            return backupId;
        }

        public boolean isSuccess() {
            return success;
        }

        public String getErrorMessage() {
            return errorMessage;
        }

        public LocalDateTime getCompletionTime() {
            return completionTime;
        }

        public long getBackupSize() {
            return backupSize;
        }

        public Map<String, String> getChecksums() {
            return checksums;
        }
    }
} 