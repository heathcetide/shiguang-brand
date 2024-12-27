package com.foodrecord.service.impl;

import com.foodrecord.service.IpBlockService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import javax.servlet.http.HttpServletRequest;
import java.util.concurrent.TimeUnit;

@Service
public class IpBlockServiceImpl implements IpBlockService {

    @Autowired
    private StringRedisTemplate redisTemplate;
    private static final String IP_BLOCK_SINGLE_KEY_PREFIX = "BLOCKED_IP:";
    private static final String IP_COUNT_KEY_PREFIX = "IP_COUNT:";
    private static final int MAX_ATTEMPTS = 5; // 最大异常访问次数
    private static final long BLOCK_DURATION = 60; // 封禁时长（秒）
    private static final long COUNT_DURATION = 60; // 计数时长（秒）

    /**
     * 检查是否被封禁
     */
    public boolean isBlocked(String ip) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(IP_BLOCK_SINGLE_KEY_PREFIX + ip));
    }

    /**
     * 记录异常访问
     */
    public void recordAbnormalAccess(String ip) {
        try {
            String countKey = IP_COUNT_KEY_PREFIX + ip;

            // 增加计数
            Long count = redisTemplate.opsForValue().increment(countKey);
            System.out.println("IP: " + ip + " 当前异常访问次数: " + count);

            if (count == 1) {
                // 首次记录，设置过期时间
                redisTemplate.expire(countKey, COUNT_DURATION, TimeUnit.SECONDS);
            }

            // 超过最大次数则封禁 IP
            if (count != null && count >= MAX_ATTEMPTS) {
                // 设置封禁状态
                redisTemplate.opsForValue().set(IP_BLOCK_SINGLE_KEY_PREFIX + ip, "BLOCKED", BLOCK_DURATION, TimeUnit.SECONDS);
                redisTemplate.delete(countKey); // 清除计数器
                System.out.println("IP: " + ip + " 已被封禁");
            }
        } catch (Exception e) {
            System.err.println("Redis 操作失败：" + e.getMessage());
        }
    }



    @Override
    public String getClientIp(HttpServletRequest request) {
        String xForwardedFor = request.getHeader("X-Forwarded-For");
        if (xForwardedFor != null && !xForwardedFor.isEmpty()) {
            return xForwardedFor.split(",")[0];
        }
        String xRealIp = request.getHeader("X-Real-IP");
        return xRealIp != null && !xRealIp.isEmpty() ? xRealIp : request.getRemoteAddr();
    }

    /**
     * 清理封禁记录
     * 可以添加一个后台任务定期清理过期的封禁记录。例如：
     * @Scheduled(fixedDelay = 3600000) // 每小时运行一次
     * public void clearExpiredBlocks() {
     *     Set<String> keys = redisTemplate.keys(IP_BLOCK_SINGLE_KEY_PREFIX + "*");
     *     if (keys != null) {
     *         for (String key : keys) {
     *             if (redisTemplate.getExpire(key) <= 0) {
     *                 redisTemplate.delete(key);
     *             }
     *         }
     *     }
     * }
     */
}
