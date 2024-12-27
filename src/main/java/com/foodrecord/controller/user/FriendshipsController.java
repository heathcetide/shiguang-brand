package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.service.FriendshipsService;
import com.foodrecord.service.IpBlockService;
import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import com.google.common.util.concurrent.RateLimiter;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;


/**
 * 主要优化和新增的功能：
 * 性能优化：
 * 添加了本地缓存和Redis缓存
 * 实现了动态限流
 * 使用CompletableFuture处理异步操作
 * 添加了专门的线程池
 * 安全性：
 * 添加了IP封禁检查
 * 实现了请求频率限制
 * 添加了各种上限控制
 * 新增功能：
 * 批量处理好友请求
 * 获取共同好友
 * 好友推荐
 * 支持好友列表过滤
 * 添加好友请求可以带消息
 * 其他优化：
 * 更完善的错误处理
 * 更清晰的代码结构
 * 添加了常量定义
 * 实现了缓存自动过期
 */
@RestController
@RequestMapping("/friend_ship")
@Api(tags = "好友管理")
public class FriendshipsController {
    
    @Resource
    private FriendshipsService friendshipsService;
    
    @Resource
    private RedisTemplate<String, Object> redisTemplate;
    
    @Autowired
    private IpBlockService ipBlockService;

    public static final String KEY_FRIENDSHIP = "friendship:";
    public static final String KEY_FRIEND_LIST = "friend_list:";
    public static final String KEY_PENDING_REQUESTS = "pending_requests:";
    public static final int FRIENDSHIP_CACHE_TTL = 30; // 缓存过期时间（分钟）

    // 好友关系状态
    public static final int STATUS_PENDING = 0;    // 待处理
    public static final int STATUS_ACCEPTED = 1;   // 已接受
    public static final int STATUS_REJECTED = 2;   // 已拒绝
    public static final int STATUS_BLOCKED = 3;    // 已屏蔽
    public static final int STATUS_DELETED = 4;    // 已删除

    // 好友上限
    public static final int MAX_FRIENDS = 500;     // 最大好友数量
    public static final int MAX_PENDING = 100;     // 最大待处理请求数


    // 限流器配置
    private final RateLimiter rateLimiter = RateLimiter.create(20.0);

    // Guava本地缓存配置
    private final Cache<String, List<Map<String, Object>>> friendListCache = CacheBuilder.newBuilder()
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .maximumSize(1000)
            .recordStats()
            .build();

    // 批量操作线程池
    private final ExecutorService executorService = Executors.newFixedThreadPool(4);

    @Scheduled(fixedRate = 5000)
    public void adjustRateLimiter() {
        long maxMemory = Runtime.getRuntime().maxMemory();
        long usedMemory = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
        double memoryUsage = (double) usedMemory / maxMemory;
        
        double dynamicRateLimit;
        if (memoryUsage < 0.5) {
            dynamicRateLimit = 20.0;
        } else if (memoryUsage < 0.8) {
            dynamicRateLimit = 10.0;
        } else {
            dynamicRateLimit = 5.0;
        }
        
        rateLimiter.setRate(dynamicRateLimit);
    }

    @PostMapping("/sendRequest")
    @ApiOperation(value = "发送好友请求")
    public ApiResponse<String> sendFriendRequest(
            @RequestParam Long userId,
            @RequestParam Long friendId,
            @RequestParam(required = false) String message,
            HttpServletRequest request) {
        
        // IP检查
        String clientIp = ipBlockService.getClientIp(request);
        if (ipBlockService.isBlocked(clientIp)) {
            throw new RuntimeException("IP被封禁，请稍后再试");
        }

        // 限流检查
        if (!rateLimiter.tryAcquire()) {
            throw new RuntimeException("请求过于频繁，请稍后再试");
        }

        try {
            // 参数检查
            if (userId.equals(friendId)) {
                return ApiResponse.error(300,"不能添加自己为好友");
            }

            // 检查是否达到好友上限
            int friendCount = friendshipsService.getFriendCount(userId);
            if (friendCount >= MAX_FRIENDS) {
                return ApiResponse.error(300,"已达到好友数量上限");
            }

            // 检查是否有待处理的请求数量上限
            int pendingCount = friendshipsService.getPendingRequestCount(friendId);
            if (pendingCount >= MAX_PENDING) {
                return ApiResponse.error(300,"对方待处理的好友请求已达上限");
            }

            return friendshipsService.sendFriendRequest(userId, friendId, message);
        } catch (Exception e) {
            return ApiResponse.error(300,"发送好友请求失败：" + e.getMessage());
        }
    }

    @GetMapping("/friendList/{userId}")
    @ApiOperation(value = "获取好友列表")
    public ApiResponse<List<Map<String, Object>>> getFriendList(
            @PathVariable Long userId,
            @RequestParam(required = false) String filter,
            HttpServletRequest request) {
        
        String clientIp = ipBlockService.getClientIp(request);
        if (ipBlockService.isBlocked(clientIp)) {
            throw new RuntimeException("IP被封禁，请稍后再试");
        }

        return (ApiResponse<List<Map<String, Object>>>) CompletableFuture.supplyAsync(() -> {
            try {
                // 查询本地缓存
                String cacheKey = KEY_FRIEND_LIST + userId + ":" + (filter != null ? filter : "all");
                List<Map<String, Object>> friendList = friendListCache.getIfPresent(cacheKey);
                if (friendList != null) {
                    return ApiResponse.success(friendList);
                }

                // 查询Redis缓存
                Object cachedData = redisTemplate.opsForValue().get(cacheKey);
                if (cachedData instanceof List) {
                    friendList = (List<Map<String, Object>>) cachedData;
                    friendListCache.put(cacheKey, friendList);
                    return ApiResponse.success(friendList);
                }

                // 查询数据库
                ApiResponse<List<Map<String, Object>>> result = friendshipsService.getFriendList(userId, filter);
                if (result.getData() != null) {
                    // 异步更新缓存
                    updateFriendListCache(cacheKey, result.getData());
                }
                return result;
            } catch (Exception e) {
                return ApiResponse.error(300, "获取好友列表失败：" + e.getMessage());
            }
        }).join();
    }

    @PostMapping("/batchOperation")
    @ApiOperation(value = "批量处理好友请求")
    public ApiResponse<String> batchProcessRequests(
            @RequestParam Long userId,
            @RequestParam List<Long> requestIds,
            @RequestParam Integer operation) {
        
        if (!rateLimiter.tryAcquire()) {
            throw new RuntimeException("请求过于频繁，请稍后再试");
        }

        try {
            return friendshipsService.batchProcessRequests(userId, requestIds, operation);
        } catch (Exception e) {
            return ApiResponse.error(300,"批量处理失败：" + e.getMessage());
        }
    }

    @GetMapping("/mutualFriends")
    @ApiOperation(value = "获取共同好友")
    public ApiResponse<List<Map<String, Object>>> getMutualFriends(
            @RequestParam Long userId1,
            @RequestParam Long userId2) {
        
        if (!rateLimiter.tryAcquire()) {
            throw new RuntimeException("请求过于频繁，请稍后再试");
        }
        try {
            return friendshipsService.getMutualFriends(userId1, userId2);
        } catch (Exception e) {
            return ApiResponse.error(300,"获取共同好友失败：" + e.getMessage());
        }
    }

    @PostMapping("/recommendFriends")
    @ApiOperation(value = "获取好友推荐")
    public ApiResponse<List<Map<String, Object>>> getRecommendedFriends(
            @RequestParam Long userId,
            @RequestParam(defaultValue = "10") Integer limit) {
        
        if (!rateLimiter.tryAcquire()) {
            throw new RuntimeException("请求过于频繁，请稍后再试");
        }

        try {
            return friendshipsService.getRecommendedFriends(userId, limit);
        } catch (Exception e) {
            return ApiResponse.error(300,"获取好友推荐失败：" + e.getMessage());
        }
    }

    @PutMapping("/acceptRequest/{id}")
    @ApiOperation(value = "接受好友请求")
    public ApiResponse<String> acceptFriendRequest(@PathVariable Long id) {
        return friendshipsService.acceptFriendRequest(id);
    }

    @DeleteMapping("/deleteFriend")
    @ApiOperation(value = "删除好友")
    public ApiResponse<Boolean> deleteFriend(@RequestParam Long userId, @RequestParam Long friendId) {
        return friendshipsService.deleteFriend(userId, friendId);
    }

    @GetMapping("/pendingRequests/{userId}")
    @ApiOperation(value = "获取待处理好友请求")
    public ApiResponse<List<Map<String, Object>>> getPendingRequests(@PathVariable Long userId) {
        return friendshipsService.getPendingRequests(userId);
    }

    @DeleteMapping("/rejectRequest/{id}")
    @ApiOperation(value = "拒绝好友请求")
    public ApiResponse<String> rejectFriendRequest(@PathVariable Long id) {
        return friendshipsService.rejectFriendRequest(id);
    }

    @GetMapping("/friendshipStatus")
    @ApiOperation(value = "获取好友状态")
    public ApiResponse<Integer> getFriendshipStatus(@RequestParam Long userId, @RequestParam Long friendId) {
        return friendshipsService.getFriendshipStatus(userId, friendId);
    }

    @DeleteMapping("/cancelRequest")
    @ApiOperation(value = "取消好友请求")
    public ApiResponse<String> cancelFriendRequest(@RequestParam Long userId, @RequestParam Long friendId) {
        return friendshipsService.cancelFriendRequest(userId, friendId);
    }

    @PostMapping("/blockUser")
    @ApiOperation(value = "屏蔽用户")
    public ApiResponse<String> blockUser(@RequestParam Long userId, @RequestParam Long friendId) {
        return friendshipsService.blockUser(userId, friendId);
    }

    private void updateFriendListCache(String cacheKey, List<Map<String, Object>> friendList) {
        CompletableFuture.runAsync(() -> {
            try {
                redisTemplate.opsForValue().set(cacheKey, friendList);
                redisTemplate.expire(cacheKey, FRIENDSHIP_CACHE_TTL, TimeUnit.MINUTES);
                friendListCache.put(cacheKey, friendList);
            } catch (Exception e) {
                System.out.println("更新好友列表缓存失败: " + e.getMessage());
            }
        });
    }
}
