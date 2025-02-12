package com.foodrecord.profile;

import com.foodrecord.profile.model.UserProfileEvent;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;

import javax.annotation.Resource;
import java.util.*;
import java.util.stream.Collectors;

@Component
public class UserProfiler {

    @Resource
    private RedisTemplate<String, String> redisTemplate;

    private static final String PROFILE_KEY = "profile:";
    private static final String TAG_KEY = "tag:";
    private static final String BEHAVIOR_KEY = "behavior:";
    private static final String INTEREST_KEY = "interest:";

    /**
     * 更新用户画像
     */
    public void updateUserProfile(Long userId, UserProfileEvent event) {
        // 1. 更新基础画像
        updateBasicProfile(userId, event);
        
        // 2. 更新行为特征
        updateBehaviorFeatures(userId, event);
        
        // 3. 更新兴趣标签
        updateInterestTags(userId, event);
        
        // 4. 更新用户分群
        updateUserSegments(userId);
    }

    /**
     * 获取用户画像
     */
    public UserProfile getUserProfile(Long userId) {
        String key = PROFILE_KEY + userId;
        Map<Object, Object> profileData = redisTemplate.opsForHash().entries(key);
        
        UserProfile profile = new UserProfile();
        profile.setUserId(userId);
        profile.setBasicFeatures(getBasicFeatures(profileData));
        profile.setBehaviorFeatures(getBehaviorFeatures(userId));
        profile.setInterestTags(getInterestTags(userId));
        profile.setSegments(getUserSegments(userId));
        
        return profile;
    }

    /**
     * 获取相似用户
     */
    public List<Long> getSimilarUsers(Long userId, int limit) {
        UserProfile profile = getUserProfile(userId);
        Set<String> userTags = profile.getInterestTags();
        
        // 基于标签查找相似用户
        Map<Long, Double> similarityScores = new HashMap<>();
        for (String tag : userTags) {
            Set<String> users = redisTemplate.opsForSet().members(TAG_KEY + tag);
            if (users != null) {
                for (String uid : users) {
                    Long otherId = Long.parseLong(uid);
                    if (!otherId.equals(userId)) {
                        similarityScores.merge(otherId, 1.0, Double::sum);
                    }
                }
            }
        }
        
        // 排序并返回最相似的用户
        return similarityScores.entrySet().stream()
                .sorted(Map.Entry.<Long, Double>comparingByValue().reversed())
                .limit(limit)
                .map(Map.Entry::getKey)
                .collect(Collectors.toList());
    }

    private void updateBasicProfile(Long userId, UserProfileEvent event) {
        String key = PROFILE_KEY + userId;
        redisTemplate.opsForHash().putAll(key, event.getProperties());
    }

    private void updateBehaviorFeatures(Long userId, UserProfileEvent event) {
        String key = BEHAVIOR_KEY + userId;
        String eventType = event.getEventType();
        
        // 更新行为计数
        redisTemplate.opsForHash().increment(key, eventType, 1);
        
        // 更新行为时间
        redisTemplate.opsForHash().put(key + ":time", 
            eventType, event.getTimestamp());
    }

    private void updateInterestTags(Long userId, UserProfileEvent event) {
        // TODO: 实现兴趣标签更新逻辑
    }

    private void updateUserSegments(Long userId) {
        // TODO: 实现用户分群更新逻辑
    }

    private Map<String, Object> getBasicFeatures(Map<Object, Object> profileData) {
        // TODO: 实现基础特征获取逻辑
        return new HashMap<>();
    }

    private Map<String, Object> getBehaviorFeatures(Long userId) {
        // TODO: 实现行为特征获取逻辑
        return new HashMap<>();
    }

    private Set<String> getInterestTags(Long userId) {
        // TODO: 实现兴趣标签获取逻辑
        return new HashSet<>();
    }

    private List<String> getUserSegments(Long userId) {
        // TODO: 实现用户分群获取逻辑
        return new ArrayList<>();
    }
} 