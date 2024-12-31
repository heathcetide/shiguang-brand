package com.foodrecord.core.disaster;

import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

@Service
public class BackupStorageServiceImpl implements BackupStorageService {

    private static final String STORAGE_DIRECTORY = "backup_storage"; // 存储备份的目标目录

    @Override
    public void store(BackupMetadata metadata, DatabaseBackup dbBackup, FileSystemBackup fsBackup) {
        // 确保存储目录存在
        File storageDir = new File(STORAGE_DIRECTORY);
        if (!storageDir.exists() && !storageDir.mkdirs()) {
            throw new RuntimeException("Failed to create storage directory: " + STORAGE_DIRECTORY);
        }

//        // 存储数据库备份
//        if (dbBackup != null && dbBackup.isSuccess()) {
//            File dbBackupFile = new File(dbBackup.getBackupFilePath());
//            if (dbBackupFile.exists()) {
//                try {
//                    Path targetPath = Path.of(STORAGE_DIRECTORY, "db_" + metadata.getTimestamp() + ".sql");
//                    Files.copy(dbBackupFile.toPath(), targetPath, StandardCopyOption.REPLACE_EXISTING);
//                    System.out.println("Database backup stored successfully: " + targetPath.toString());
//                } catch (IOException e) {
//                    throw new RuntimeException("Failed to store database backup: " + e.getMessage(), e);
//                }
//            } else {
//                System.err.println("Database backup file not found: " + dbBackup.getBackupFilePath());
//            }
//        }

//        // 存储文件系统备份
//        if (fsBackup != null && fsBackup.isSuccess()) {
//            File fsBackupDir = new File(fsBackup.getBackupDirectory());
//            if (fsBackupDir.exists() && fsBackupDir.isDirectory()) {
//                try {
//                    Path targetPath = Path.of(STORAGE_DIRECTORY, "fs_backup_" + metadata.getTimestamp());
//                    copyDirectory(fsBackupDir.toPath(), targetPath);
//                    System.out.println("File system backup stored successfully: " + targetPath.toString());
//                } catch (IOException e) {
//                    throw new RuntimeException("Failed to store file system backup: " + e.getMessage(), e);
//                }
//            } else {
//                System.err.println("File system backup directory not found: " + fsBackup.getBackupDirectory());
//            }
//        }

        // 存储元数据
        try {
            Path metadataFilePath = Path.of(STORAGE_DIRECTORY, "metadata_" + metadata.getTimestamp() + ".json");
            Files.writeString(metadataFilePath, metadata.getBackupId());
            System.out.println("Backup metadata stored successfully: " + metadataFilePath.toString());
        } catch (IOException e) {
            throw new RuntimeException("Failed to store backup metadata: " + e.getMessage(), e);
        }
    }

    /**
     * 递归复制目录及其内容
     */
    private void copyDirectory(Path source, Path destination) throws IOException {
        Files.walk(source).forEach(path -> {
            try {
                Path targetPath = destination.resolve(source.relativize(path));
                if (Files.isDirectory(path)) {
                    Files.createDirectories(targetPath);
                } else {
                    Files.copy(path, targetPath, StandardCopyOption.REPLACE_EXISTING);
                }
            } catch (IOException e) {
                throw new RuntimeException("Failed to copy directory: " + e.getMessage(), e);
            }
        });
    }
}
