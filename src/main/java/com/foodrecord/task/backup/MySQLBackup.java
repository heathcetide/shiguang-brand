package com.foodrecord.task.backup;

import java.io.IOException;
import java.io.BufferedReader;
import java.io.InputStreamReader;
public class MySQLBackup {

    public static void fullBackup(String host, String port, String user, String password, String database, String backupDir) throws IOException, InterruptedException {
        String backupFile = getBackupFilePath(backupDir, "full_backup_" + System.currentTimeMillis() + ".sql");

        String command = String.format(
                "mysqldump -h%s -P%s -u%s -p%s --default-character-set=utf8 --single-transaction --quick --routines --events %s > %s",
                host, port, user, password, database, backupFile
        );

        System.out.println("Executing command: " + command); // 打印完整命令

        boolean isWindows = System.getProperty("os.name").toLowerCase().contains("win");

        ProcessBuilder pb = isWindows
                ? new ProcessBuilder("cmd.exe", "/c", command)
                : new ProcessBuilder("/bin/sh", "-c", command);

        pb.redirectErrorStream(true);
        Process process = pb.start();

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                System.out.println(line); // 打印日志
            }
        }

        int exitCode = process.waitFor();
        if (exitCode == 0) {
            System.out.println("Full backup completed: " + backupFile);
        } else {
            throw new RuntimeException("Full backup failed. Exit code: " + exitCode);
        }
    }

    public static String getBackupFilePath(String backupDir, String fileName) {
        String os = System.getProperty("os.name").toLowerCase();
        String separator = os.contains("win") ? "\\" : "/";
        return backupDir + separator + fileName;
    }
}
