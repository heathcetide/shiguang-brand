package com.foodrecord.task.backup;

import java.io.IOException;

public class MySQLPartitionBackupUtil {

    // 分区备份方法
    public static void partitionBackup(String host, String port, String user, String password, String database, String table, int startId, int endId, String backupDir) throws IOException, InterruptedException {
        // 备份文件路径
        String backupFile = backupDir + "/" + table + "_part_" + startId + "_" + endId + ".sql";

        // 分区备份命令
        String command = String.format(
                "mysqldump -h%s -P%s -u%s -p%s %s %s --where='id BETWEEN %d AND %d' > %s",
                host, port, user, password, database, table, startId, endId, backupFile
        );

        // 执行命令
        ProcessBuilder pb = new ProcessBuilder("/bin/sh", "-c", command);
        pb.redirectErrorStream(true);
        Process process = pb.start();
        int exitCode = process.waitFor();

        // 检查执行结果
        if (exitCode == 0) {
            System.out.println("Partition backup completed: " + backupFile);
        } else {
            throw new RuntimeException("Partition backup failed. Exit code: " + exitCode);
        }
    }
}
