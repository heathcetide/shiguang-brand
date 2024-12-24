package com.foodrecord.task.backup;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Service
public class ParallelBackup {

    private final ExecutorService executorService = Executors.newFixedThreadPool(4); // 并行线程池

    @Scheduled(cron = "0 0 1 * * ?") // 每天凌晨 1 点执行分块备份
    public void executeParallelBackup() {
        try {
            // 分块备份 1
            executorService.submit(() -> {
                try {
                    MySQLPartitionBackupUtil.partitionBackup("localhost", "3306", "root", "password", "your_database",
                            "food_basic", 1, 500000, "/data/backups");
                    System.out.println("Backup for food_basic (1-500000) completed.");
                } catch (Exception e) {
                    e.printStackTrace();
                }
            });

            // 分块备份 2
            executorService.submit(() -> {
                try {
                    MySQLPartitionBackupUtil.partitionBackup("localhost", "3306", "root", "password", "your_database",
                            "food_basic", 500001, 1000000, "/data/backups");
                    System.out.println("Backup for food_basic (500001-1000000) completed.");
                } catch (Exception e) {
                    e.printStackTrace();
                }
            });

            // 分块备份 3
            executorService.submit(() -> {
                try {
                    MySQLPartitionBackupUtil.partitionBackup("localhost", "3306", "root", "password", "your_database",
                            "food_basic_v2", 1, 500000, "/data/backups");
                    System.out.println("Backup for food_basic_v2 (1-500000) completed.");
                } catch (Exception e) {
                    e.printStackTrace();
                }
            });

        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}