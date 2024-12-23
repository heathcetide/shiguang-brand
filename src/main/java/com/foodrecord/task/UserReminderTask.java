package com.foodrecord.task;

import com.foodrecord.common.utils.CronExpressionUtils;
import com.foodrecord.notification.NotificationService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.support.CronTrigger;
import org.springframework.stereotype.Component;

import java.time.LocalTime;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

@Component
public class UserReminderTask {

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private UserReminderService reminderService;

    @Autowired
    private TaskScheduler taskScheduler;

    private final Map<Long, Map<String, ScheduledFuture<?>>> userTasks = new ConcurrentHashMap<>();

    /**
     * 加载用户任务
     */
    public void loadUserTasks(Long userId) {
        // 清理旧任务
        Map<String, ScheduledFuture<?>> mealTasks = userTasks.getOrDefault(userId, new ConcurrentHashMap<>());
        mealTasks.values().forEach(task -> task.cancel(false));
        userTasks.remove(userId);

        // 加载新任务
        Map<String, ScheduledFuture<?>> newTasks = new ConcurrentHashMap<>();
        for (String mealType : new String[]{"breakfast", "lunch", "dinner"}) {
            LocalTime reminderTime = reminderService.getReminderTime(userId, mealType);
            String cronExpression = CronExpressionUtils.generateCronExpression(String.valueOf(reminderTime));

            ScheduledFuture<?> task = taskScheduler.schedule(() -> {
                sendReminder(userId, mealType);
            }, new CronTrigger(cronExpression));

            newTasks.put(mealType, task);
        }
        userTasks.put(userId, newTasks);
    }

    private void sendReminder(Long userId, String mealType) {
        String greeting = generateGreeting(mealType, userId);
        System.out.printf("提醒用户 %d: %s 时间到了！问候语: %s%n", userId, mealType, greeting);
        notificationService.sendNotificationBasedOnPreference(userId, greeting);
    }

    /**
     * 生成个性化的问候语
     */
    private String generateGreeting(String mealType, Long userId) {
        String userName = getUserNickname(userId); // 假设从用户信息中获取昵称
        switch (mealType.toLowerCase()) {
            case "breakfast":
                return String.format("早上好，%s！新的一天从美味早餐开始，记得吃点营养的东西哦！", userName);
            case "lunch":
                return String.format("中午好，%s！午餐时间到了，别忘了补充能量，健康最重要！", userName);
            case "dinner":
                return String.format("晚上好，%s！一天辛苦了，来点美味的晚餐犒劳自己吧！", userName);
            default:
                return String.format("用餐时间到了，%s，愿您享受每一口美食！", userName);
        }
    }

    /**
     * 获取用户昵称（模拟方法，可与数据库或缓存交互）
     */
    private String getUserNickname(Long userId) {
        // 假设从数据库或缓存中获取用户昵称
        // 实际应用中可以调用 UserService 或 Redis 读取用户信息
        return "亲爱的用户"; // 默认昵称
    }
}
