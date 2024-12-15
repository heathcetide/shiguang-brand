package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.common.utils.RedisUtils;
import com.foodrecord.mapper.SensitiveOperationLogMapper;
import com.foodrecord.model.entity.SensitiveOperationLog;
import com.foodrecord.service.SensitiveOperationLogService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import java.time.LocalDateTime;
import java.util.List;

@Service
public class SensitiveOperationLogServiceImpl extends ServiceImpl<SensitiveOperationLogMapper, SensitiveOperationLog> implements SensitiveOperationLogService {
    @Resource
    private SensitiveOperationLogMapper logMapper;
    private final RedisUtils redisUtils;
    
    private static final String LOG_CACHE_KEY = "sensitive_log:";
    private static final long CACHE_TIME = 3600; // 1小时

    public SensitiveOperationLogServiceImpl(RedisUtils redisUtils) {
        this.redisUtils = redisUtils;
    }

    @Override
    @Transactional
    public void logOperation(Long userId, String operationType, String detail, HttpServletRequest request, String status, String failureReason) {
        SensitiveOperationLog log = new SensitiveOperationLog();
        log.setUserId(userId);
        log.setOperationType(operationType);
        log.setOperationDetail(detail);
        log.setOperationTime(LocalDateTime.now());
        log.setIpAddress(getClientIp(request));
        log.setUserAgent(request.getHeader("User-Agent"));
        log.setStatus(status);
        log.setFailureReason(failureReason);
        
        save(log);
        
        // 缓存最近的操作日志
        String key = LOG_CACHE_KEY + userId;
        List<SensitiveOperationLog> recentLogs = getRecentLogs(userId);
        recentLogs.add(0, log);
        if (recentLogs.size() > 10) { // 只保留最近10条
            recentLogs = recentLogs.subList(0, 10);
        }
        redisUtils.set(key, recentLogs, CACHE_TIME);
    }

    @Override
    public List<SensitiveOperationLog> getRecentLogs(Long userId) {
        String key = LOG_CACHE_KEY + userId;
        Object cached = redisUtils.get(key);
        if (cached != null) {
            return (List<SensitiveOperationLog>) cached;
        }
        
        // 从数据库获取最近10条记录
        List<SensitiveOperationLog> logs = logMapper.selectRecentByUserId(userId, 10);
        redisUtils.set(key, logs, CACHE_TIME);
        return logs;
    }

    private String getClientIp(HttpServletRequest request) {
        String ip = request.getHeader("X-Forwarded-For");
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("Proxy-Client-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("WL-Proxy-Client-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("HTTP_CLIENT_IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("HTTP_X_FORWARDED_FOR");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getRemoteAddr();
        }
        return ip;
    }
} 