package com.foodrecord.config;

import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;

@Component
public class ProgressTracker {

    private final ConcurrentHashMap<String, Integer> taskProgress = new ConcurrentHashMap<>();

    // 更新任务进度
    public void updateProgress(String taskId, int progress) {
        taskProgress.put(taskId, progress);
    }

    // 获取任务进度
    public int getProgress(String taskId) {
        return taskProgress.getOrDefault(taskId, 0);
    }

    // 删除任务进度
    public void removeProgress(String taskId) {
        taskProgress.remove(taskId);
    }
}
