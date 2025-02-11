package com.foodrecord.task.backup;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Service
public class BackupScheduler {
    private final ExecutorService executorService = Executors.newFixedThreadPool(4); // 并行线程池

    // **手动全量备份**
    public boolean fullBackup() {
        try {
            executorService.submit(() -> {
                try {
                    MySQLBackup.fullBackup("localhost", "3306", "root", "1234", "food_record", "G:/项目实战/project-6_shiguang-Brand/shiguang-brand/data/backups");
                    System.out.println("Full backup completed!");
                } catch (Exception e) {
                    e.printStackTrace();
                    System.err.println("Full backup failed!");
                }
            });
            return true;
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
    }

    // **手动增量备份**
    public boolean incrementalBackup() {
        try {
            executorService.submit(() -> {
                try {
                    MySQLIncrementalBackupUtil.incrementalBackup("/data/backups", "/var/lib/mysql");
                    System.out.println("Incremental backup completed!");
                } catch (Exception e) {
                    e.printStackTrace();
                    System.err.println("Incremental backup failed!");
                }
            });
            return true;
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
    }

    // **手动分区备份**
    public boolean partitionBackup(String tableName, int startId, int endId) {
        try {
            executorService.submit(() -> {
                try {
                    MySQLPartitionBackupUtil.partitionBackup(
                            "localhost",
                            "3306",
                            "root",
                            "password",
                            "your_database",
                            tableName,
                            startId,
                            endId,
                            "/data/backups"
                    );
                    System.out.println("Partition backup completed for table: " + tableName);
                } catch (Exception e) {
                    e.printStackTrace();
                    System.err.println("Partition backup failed for table: " + tableName);
                }
            });
            return true;
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
    }


    // 全量备份任务：每周日凌晨 2 点执行
    @Scheduled(cron = "0 0 2 * * SUN")
    public void fullBackupTask() {
        executorService.submit(() -> {
            try {
                MySQLBackup.fullBackup("localhost", "3306", "root", "password", "your_database", "/data/backups");
                System.out.println("Full backup completed!");
            } catch (Exception e) {
                e.printStackTrace();
                System.err.println("Full backup failed!");
            }
        });
    }

    // 增量备份任务：每天凌晨 3 点执行
    @Scheduled(cron = "0 0 3 * * *")
    public void incrementalBackupTask() {
        executorService.submit(() -> {
            try {
                MySQLIncrementalBackupUtil.incrementalBackup("/data/backups", "/var/lib/mysql");
                System.out.println("Incremental backup completed!");
            } catch (Exception e) {
                e.printStackTrace();
                System.err.println("Incremental backup failed!");
            }
        });
    }

    // 分区备份任务：每周六凌晨 1 点执行
    @Scheduled(cron = "0 0 1 * * SAT")
    public void partitionBackupTask() {
        executorService.submit(() -> {
            try {
                MySQLPartitionBackupUtil.partitionBackup("localhost", "3306", "root", "password", "your_database",
                        "food_basic", 1, 500000, "/data/backups");
                MySQLPartitionBackupUtil.partitionBackup("localhost", "3306", "root", "password", "your_database",
                        "food_basic", 500001, 1000000, "/data/backups");
                System.out.println("Partition backup completed!");
            } catch (Exception e) {
                e.printStackTrace();
                System.err.println("Partition backup failed!");
            }
        });
    }
}
