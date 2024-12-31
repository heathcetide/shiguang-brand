package com.foodrecord.core.disaster;

import org.springframework.stereotype.Service;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;

@Service
public class BackupVerificationServiceImpl implements BackupVerificationService {

    private static final String STORAGE_DIRECTORY = "backup_storage"; // 备份存储目录

    @Override
    public boolean verifyBackup(String backupId) {
        try {
            // 检查元数据文件是否存在
            Path metadataPath = Path.of(STORAGE_DIRECTORY, "metadata_" + backupId + ".json");
            if (!Files.exists(metadataPath)) {
                System.err.println("Backup metadata not found for ID: " + backupId);
                return false;
            }

            // 检查数据库备份文件是否存在
            Path dbBackupPath = Path.of(STORAGE_DIRECTORY, "db_" + backupId + ".sql");
            if (!Files.exists(dbBackupPath)) {
                System.err.println("Database backup file not found for ID: " + backupId);
                return false;
            }

            // 检查文件系统备份目录是否存在
            Path fsBackupPath = Path.of(STORAGE_DIRECTORY, "fs_backup_" + backupId);
            if (!Files.exists(fsBackupPath) || !Files.isDirectory(fsBackupPath)) {
                System.err.println("File system backup directory not found for ID: " + backupId);
                return false;
            }

            // 如果所有文件都存在，返回验证成功
            System.out.println("Backup verification successful for ID: " + backupId);
            return true;

        } catch (Exception e) {
            System.err.println("Error occurred during backup verification: " + e.getMessage());
            return false;
        }
    }
}
