package com.foodrecord.controller.guest;

import com.foodrecord.common.auth.RequireRole;
import com.foodrecord.config.ProgressTracker;
import com.foodrecord.task.backup.BackupScheduler;
import com.foodrecord.task.backup.RestoreService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.PrintWriter;

@RestController
@RequestMapping("/restore")
@Api(tags = "数据备份模块")
public class RestoreController {

    @Autowired
    private RestoreService restoreService;

    @PostMapping("/start/{taskId}")
    @ApiOperation("数据恢复")
    public String startRestore(@PathVariable String taskId) {
        restoreService.restoreData(taskId);
        return "Restore task started with ID: " + taskId;
    }

    @Autowired
    private ProgressTracker progressTracker;

    @GetMapping("/progress")
    public void getProgress(@RequestParam String taskId, HttpServletResponse response) throws IOException, InterruptedException {
        // 设置响应头，告知客户端这是 SSE 流
        response.setContentType("text/event-stream");
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Connection", "keep-alive");

        PrintWriter writer = response.getWriter();

        try {
            while (true) {
                int progress = progressTracker.getProgress(taskId);

                // 推送进度给客户端
                writer.write("data: " + progress + "\n\n");
                writer.flush();

                if (progress >= 100) {
                    break; // 任务完成时结束推送
                }

                Thread.sleep(1000); // 模拟每秒更新一次
            }
        } finally {
            writer.close();
        }
    }

    @Autowired
    private BackupScheduler backupService;

    // 手动全量备份接口
    @PostMapping("/full")
    public String manualFullBackup() {
        boolean isStarted = backupService.fullBackup();
        return isStarted ? "Full backup started successfully!" : "Full backup task failed to start.";
    }

    // 手动增量备份接口
    @PostMapping("/incremental")
    public String manualIncrementalBackup() {
        boolean isStarted = backupService.incrementalBackup();
        return isStarted ? "Incremental backup started successfully!" : "Incremental backup task failed to start.";
    }

    // 手动分区备份接口
    @PostMapping("/partition")
    public String manualPartitionBackup(
            @RequestParam String tableName,
            @RequestParam int startId,
            @RequestParam int endId
    ) {
        boolean isStarted = backupService.partitionBackup(tableName, startId, endId);
        return isStarted ? "Partition backup started successfully!" : "Partition backup task failed to start.";
    }
}
