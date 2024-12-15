package com.foodrecord.common.security;

import com.foodrecord.common.utils.RedisUtils;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Set;

@Service
public class IpBlacklistService {
    private final RedisUtils redisUtils;
    
    private static final String BLACKLIST_KEY = "ip_blacklist";
    private static final String IP_ATTEMPTS_PREFIX = "ip_attempts:";
    private static final int MAX_ATTEMPTS = 100;  // 每小时最大请求次数
    private static final long BLOCK_DURATION = 86400;  // 封禁时长（秒）

    public IpBlacklistService(RedisUtils redisUtils) {
        this.redisUtils = redisUtils;
    }

    public boolean isBlacklisted(String ip) {
        return redisUtils.hasKey(BLACKLIST_KEY + ":" + ip);
    }

    public void addToBlacklist(String ip, String reason) {
        redisUtils.set(BLACKLIST_KEY + ":" + ip, reason, BLOCK_DURATION);
    }

    public void removeFromBlacklist(String ip) {
        redisUtils.delete(BLACKLIST_KEY + ":" + ip);
    }

    public void recordIpAttempt(String ip) {
        String key = IP_ATTEMPTS_PREFIX + ip;
        long attempts = redisUtils.increment(key, 1);
        if (attempts == 1) {
            redisUtils.expire(key, 3600);  // 1小时后重置
        }
        
        if (attempts > MAX_ATTEMPTS) {
            addToBlacklist(ip, "请求频率过高");
        }
    }

    public Set<String> getAllBlacklistedIps() {
        return redisUtils.keys(BLACKLIST_KEY + ":*");
    }
} 