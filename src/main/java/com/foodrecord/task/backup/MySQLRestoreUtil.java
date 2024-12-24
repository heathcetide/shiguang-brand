package com.foodrecord.task.backup;

import java.io.File;
import java.io.IOException;

public class MySQLRestoreUtil {

    // 恢复全量备份
    public static void restoreFullBackup(String host, String port, String user, String password, String database, String backupFile) throws IOException, InterruptedException {
        String command = String.format("mysql -h%s -P%s -u%s -p%s %s < %s",
                host, port, user, password, database, backupFile);

        ProcessBuilder pb = new ProcessBuilder("/bin/sh", "-c", command);
        pb.redirectErrorStream(true);
        Process process = pb.start();
        int exitCode = process.waitFor();

        if (exitCode == 0) {
            System.out.println("Full restore completed: " + backupFile);
        } else {
            throw new RuntimeException("Full restore failed. Exit code: " + exitCode);
        }
    }

    // 应用增量备份
    public static void restoreIncrementalBackup(String binlogDir, String host, String port, String user, String password) throws IOException, InterruptedException {
        File dir = new File(binlogDir);
        File[] binlogFiles = dir.listFiles((d, name) -> name.startsWith("mysql-bin"));

        if (binlogFiles == null || binlogFiles.length == 0) {
            throw new RuntimeException("No binlog files found in directory: " + binlogDir);
        }

        for (File binlog : binlogFiles) {
            String command = String.format("mysqlbinlog %s | mysql -h%s -P%s -u%s -p%s",
                    binlog.getAbsolutePath(), host, port, user, password);

            ProcessBuilder pb = new ProcessBuilder("/bin/sh", "-c", command);
            pb.redirectErrorStream(true);
            Process process = pb.start();
            int exitCode = process.waitFor();

            if (exitCode == 0) {
                System.out.println("Incremental restore applied: " + binlog.getName());
            } else {
                throw new RuntimeException("Incremental restore failed for " + binlog.getName());
            }
        }
    }
}
