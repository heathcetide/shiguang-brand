package com.foodrecord.common.security;

import com.foodrecord.exception.RateLimitExceededException;
import com.foodrecord.common.utils.RedisUtils;
import org.springframework.stereotype.Component;

/**
 * 请求频率限制器
 * 使用Redis实现滑动窗口算法
 */
@Component
public class RedisRateLimiter {
    private final RedisUtils redisUtils;
    
    private static final String RATE_LIMIT_KEY = "rate_limit:";

    public RedisRateLimiter(RedisUtils redisUtils) {
        this.redisUtils = redisUtils;
    }

    /**
     * 检查是否超过频率限制
     * @param key 限制键（如IP、用户ID等）
     * @param limit 限制次数
     * @param period 时间周期（秒）
     * @throws RateLimitExceededException 如果超过限制
     */
    public void checkRateLimit(String key, int limit, int period) {
        String redisKey = RATE_LIMIT_KEY + key;
        long currentCount = redisUtils.increment(redisKey, 1);
        
        if (currentCount == 1) {
            redisUtils.expire(redisKey, period);
        }
        
        if (currentCount > limit) {
            throw new RateLimitExceededException("请求频率超过限制");
        }
    }
} 