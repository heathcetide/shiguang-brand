package com.foodrecord.task.backup;
import java.io.File;
import java.io.IOException;

public class MySQLIncrementalBackupUtil {

    // 增量备份方法
    public static void incrementalBackup(String backupDir, String binlogDir) throws IOException, InterruptedException {
        // 目标路径
        String incrementalBackupDir = backupDir + "/binlogs_" + System.currentTimeMillis();
        new File(incrementalBackupDir).mkdirs();

        // 复制 binlog 文件到备份目录
        String command = String.format("cp %s/* %s", binlogDir, incrementalBackupDir);

        // 执行命令
        ProcessBuilder pb = new ProcessBuilder("/bin/sh", "-c", command);
        pb.redirectErrorStream(true);
        Process process = pb.start();
        int exitCode = process.waitFor();

        // 检查执行结果
        if (exitCode == 0) {
            System.out.println("Incremental backup completed: " + incrementalBackupDir);
        } else {
            throw new RuntimeException("Incremental backup failed. Exit code: " + exitCode);
        }
    }
}
