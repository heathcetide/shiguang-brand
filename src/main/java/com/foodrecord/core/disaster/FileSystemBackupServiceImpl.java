package com.foodrecord.core.disaster;

import org.springframework.stereotype.Service;

import java.io.*;
import java.nio.file.*;
import java.text.SimpleDateFormat;
import java.util.Date;

@Service
public class FileSystemBackupServiceImpl implements FileSystemBackupService {

    private static final String BACKUP_DIRECTORY = "filesystem_backups"; // 备份存放目录
    private static final String SOURCE_DIRECTORY = "data"; // 源目录，需指定你要备份的文件夹

    @Override
    public FileSystemBackup backup() {
        // 确保备份目录存在
        File backupDir = new File(BACKUP_DIRECTORY);
        if (!backupDir.exists() && !backupDir.mkdirs()) {
            throw new RuntimeException("Failed to create backup directory: " + BACKUP_DIRECTORY);
        }

        // 生成备份目录名称（带时间戳）
        String timestamp = new SimpleDateFormat("yyyyMMddHHmmss").format(new Date());
        File destination = new File(BACKUP_DIRECTORY, "backup_" + timestamp);

        // 执行文件系统备份
        try {
            copyDirectory(Paths.get(SOURCE_DIRECTORY), destination.toPath());
//            return new FileSystemBackup(true, destination.getAbsolutePath(), "Backup successful");
            return null;
        } catch (IOException e) {
//            return new FileSystemBackup(false, null, "Backup failed: " + e.getMessage());
            return null;
        }
    }

    /**
     * 递归复制目录及其内容
     */
    private void copyDirectory(Path source, Path destination) throws IOException {
        if (!Files.exists(source)) {
            throw new FileNotFoundException("Source directory does not exist: " + source.toString());
        }

        Files.walk(source).forEach(path -> {
            try {
                Path targetPath = destination.resolve(source.relativize(path));
                if (Files.isDirectory(path)) {
                    Files.createDirectories(targetPath);
                } else {
                    Files.copy(path, targetPath, StandardCopyOption.REPLACE_EXISTING);
                }
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        });
    }
}
