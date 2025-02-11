package com.foodrecord.service.impl;

import com.foodrecord.service.IpBlockService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import javax.servlet.http.HttpServletRequest;
import java.net.InetAddress;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;

@Service
public class IpBlockServiceImpl implements IpBlockService {

    private static final Logger logger = LoggerFactory.getLogger(IpBlockServiceImpl.class);


    @Autowired
    private StringRedisTemplate redisTemplate;

    private static final String IP_BLOCK_SINGLE_KEY_PREFIX = "BLOCKED_IP:";
    private static final String IP_COUNT_KEY_PREFIX = "IP_COUNT:";

    // 外部化配置参数（可以在 application.properties 或 application.yml 中配置）
    @Value("${ip.block.maxAttempts:5}")
    private int MAX_ATTEMPTS;

    @Value("${ip.block.blockDuration:120}")
    private long BLOCK_DURATION; // 封禁时长（秒）

    @Value("${ip.block.countDuration:120}")
    private long COUNT_DURATION; // 计数时长（秒）

    private static final Set<String> WHITE_IP_SET = new HashSet<>();

    /**
     * 检查是否被封禁
     */
    @Override
    public boolean isBlocked(String ip) {
        // 白名单内的 IP 不受封禁规则
        if (WHITE_IP_SET.contains(ip)) {
            return false;
        }
        boolean blocked = Boolean.TRUE.equals(redisTemplate.hasKey(IP_BLOCK_SINGLE_KEY_PREFIX + ip));
        if (blocked) {
            logger.info("IP {} 被封禁", ip);
        }
        return blocked;
    }

    /**
     * 记录异常访问
     */
    @Override
    public void recordAbnormalAccess(String ip) {
        // 白名单不计入异常
        if (WHITE_IP_SET.contains(ip)) {
            logger.debug("IP {} 在白名单中，不计入异常访问", ip);
            return;
        }
        try {
            String countKey = IP_COUNT_KEY_PREFIX + ip;
            // 增加计数
            Long count = redisTemplate.opsForValue().increment(countKey);
            logger.info("IP: {} 当前异常访问次数: {}", ip, count);

            if (count != null && count == 1) {
                // 首次记录，设置计数过期时间
                redisTemplate.expire(countKey, COUNT_DURATION, TimeUnit.SECONDS);
            }

            // 超过最大次数则封禁 IP
            if (count != null && count >= MAX_ATTEMPTS) {
                redisTemplate.opsForValue().set(IP_BLOCK_SINGLE_KEY_PREFIX + ip, "BLOCKED", BLOCK_DURATION, TimeUnit.SECONDS);
                redisTemplate.delete(countKey); // 清除计数器
                logger.warn("IP: {} 已被封禁，封禁时长：{} 秒", ip, BLOCK_DURATION);
            }
        } catch (Exception e) {
            logger.error("记录异常访问失败，IP: {}，错误信息：{}", ip, e.getMessage());
        }
    }

    /**
     * 获取客户端真实 IP 地址，支持多级反向代理
     *
     * @param request HttpServletRequest 对象
     * @return 客户端 IP 地址
     */
    @Override
    public String getClientIp(HttpServletRequest request) {
        String ip = null;
        // 优先使用 X-Forwarded-For（可能存在多个 IP，以逗号分隔，第一个为真实 IP）
        ip = request.getHeader("X-Forwarded-For");
        if (ip != null && !ip.isEmpty() && !"unknown".equalsIgnoreCase(ip)) {
            // 多个代理的情况下，第一个 IP 为真实 IP
            int index = ip.indexOf(',');
            if (index != -1) {
                ip = ip.substring(0, index).trim();
            } else {
                ip = ip.trim();
            }
        }

        // 如果 X-Forwarded-For 没有获取到，再尝试 X-Real-IP
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("X-Real-IP");
        }

        // 如果还是无法获取，再依次尝试其他常见的 header
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("Proxy-Client-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("WL-Proxy-Client-IP");
        }

        // 最后使用 request.getRemoteAddr() 获取
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getRemoteAddr();
        }

        // 如果是本机访问，则根据网卡获取真实 IP 地址
        if ("127.0.0.1".equals(ip) || "0:0:0:0:0:0:0:1".equals(ip)) {
            try {
                InetAddress inet = InetAddress.getLocalHost();
                if (inet != null) {
                    ip = inet.getHostAddress();
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        // 防止多级代理时获取到多个 IP（以逗号分隔），只返回第一个
        if (ip != null && ip.indexOf(",") > 0) {
            ip = ip.split(",")[0].trim();
        }

        // 如果最终获取不到 IP，则默认返回 127.0.0.1
        return (ip != null && !ip.isEmpty()) ? ip : "127.0.0.1";
    }

    @Override
    public long getAttemptCount(String ip) {
        try {
            String countKey = IP_COUNT_KEY_PREFIX + ip;
            String countStr = redisTemplate.opsForValue().get(countKey);
            if (countStr != null) {
                return Long.parseLong(countStr);
            }
        } catch (Exception e) {
            logger.error("获取异常访问计数失败，IP: {}，错误信息：{}", ip, e.getMessage());
        }
        return 0;
    }

    @Override
    public void resetAttempt(String ip) {
        try {
            String countKey = IP_COUNT_KEY_PREFIX + ip;
            redisTemplate.delete(countKey);
            logger.info("IP: {} 的异常访问计数已重置", ip);
        } catch (Exception e) {
            logger.error("重置异常访问计数失败，IP: {}，错误信息：{}", ip, e.getMessage());
        }
    }

    /**
     * 将 IP 添加到白名单
     *
     * @param ip 需要添加到白名单的 IP
     */
    @Override
    public void addToWhiteList(String ip) {
        WHITE_IP_SET.add(ip);
        logger.info("IP: {} 已被添加到白名单", ip);
    }

    /**
     * 从白名单中移除 IP
     *
     * @param ip 需要移除的 IP
     */
    @Override
    public void removeFromWhiteList(String ip) {
        WHITE_IP_SET.remove(ip);
        logger.info("IP: {} 已从白名单中移除", ip);
    }

    /**
     * 查询 IP 是否在白名单中
     *
     * @param ip 需要查询的 IP
     * @return true 表示在白名单中，false 表示不在白名单中
     */
    @Override
    public boolean isInWhiteList(String ip) {
        return WHITE_IP_SET.contains(ip);
    }
}
