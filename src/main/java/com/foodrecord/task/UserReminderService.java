package com.foodrecord.task;
import com.foodrecord.common.utils.RedisUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalTime;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@Service
public class UserReminderService {

    @Autowired
    private RedisUtils redisUtils;

    // 默认提醒时间
    private static final Map<String, LocalTime> DEFAULT_REMINDER_TIMES = new HashMap<>();

    static {
        DEFAULT_REMINDER_TIMES.put("breakfast", LocalTime.of(6, 0));
        DEFAULT_REMINDER_TIMES.put("lunch", LocalTime.of(12, 0));
        DEFAULT_REMINDER_TIMES.put("dinner", LocalTime.of(17, 0));
    }

    /**
     * 设置用户提醒时间
     */
    public void setReminderTime(Long userId, String mealType, LocalTime time) {
        try {
            String key = getRedisKey(userId, mealType);
            redisUtils.set(key, time.toString(), 7L, TimeUnit.DAYS); // 存储 7 天有效期
        } catch (Exception e) {
            e.printStackTrace();
            // 如果 Redis 异常，可以记录日志或其他处理
        }
    }

    /**
     * 获取用户提醒时间，如果 Redis 宕机，则返回默认值
     */
    public LocalTime getReminderTime(Long userId, String mealType) {
        try {
            String key = getRedisKey(userId, mealType);
            String timeStr = (String) redisUtils.get(key);
            if (timeStr != null) {
                return LocalTime.parse(timeStr);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return DEFAULT_REMINDER_TIMES.getOrDefault(mealType, LocalTime.of(6, 0));
    }

    /**
     * 生成 Redis 键
     */
    private String getRedisKey(Long userId, String mealType) {
        return "reminder:" + userId + ":" + mealType;
    }
}
