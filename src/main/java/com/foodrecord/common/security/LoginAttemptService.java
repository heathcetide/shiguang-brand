package com.foodrecord.common.security;

import com.foodrecord.exception.AccountLockedException;
import com.foodrecord.common.utils.RedisUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class LoginAttemptService {
    private final RedisUtils redisUtils;
    
    @Value("${security.login.max-attempts}")
    private int maxAttempts;
    
    @Value("${security.login.lock-duration}")
    private long lockDuration;

    private static final String ATTEMPTS_KEY_PREFIX = "login_attempts:";
    private static final String BLOCKED_KEY_PREFIX = "login_blocked:";

    public LoginAttemptService(RedisUtils redisUtils) {
        this.redisUtils = redisUtils;
    }

    public void loginSucceeded(String username) {
        redisUtils.delete(ATTEMPTS_KEY_PREFIX + username);
        redisUtils.delete(BLOCKED_KEY_PREFIX + username);
    }

    public void loginFailed(String username) {
        String attemptsKey = ATTEMPTS_KEY_PREFIX + username;
        String blockedKey = BLOCKED_KEY_PREFIX + username;

        // 检查是否已被锁定
        if (redisUtils.hasKey(blockedKey)) {
            throw new AccountLockedException("账号已被锁定，请稍后再试");
        }

        // 增加失败次数
        long attempts = redisUtils.increment(attemptsKey, 1);
        if (attempts == 1) {
            redisUtils.expire(attemptsKey, 3600); // 1小时后重置
        }

        // 检查是否需要锁定
        if (attempts >= maxAttempts) {
            redisUtils.set(blockedKey, true, lockDuration);
            redisUtils.delete(attemptsKey);
            throw new AccountLockedException("登录失败次数过多，账号已被锁定" + lockDuration + "秒");
        }
    }

    public boolean isBlocked(String username) {
        return redisUtils.hasKey(BLOCKED_KEY_PREFIX + username);
    }

    public long getAttempts(String username) {
        Object attempts = redisUtils.get(ATTEMPTS_KEY_PREFIX + username);
        return attempts == null ? 0 : Long.parseLong(attempts.toString());
    }
} 