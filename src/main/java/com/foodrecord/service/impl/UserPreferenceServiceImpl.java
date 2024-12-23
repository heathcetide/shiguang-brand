package com.foodrecord.service.impl;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.foodrecord.service.UserPreferenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.foodrecord.common.utils.RedisUtils;

import java.util.HashMap;
import java.util.Map;

@Service
public class UserPreferenceServiceImpl implements UserPreferenceService {

    @Autowired
    private RedisUtils redisUtils;

    @Autowired
    private ObjectMapper objectMapper;

    private static final String USER_PREFERENCE_KEY_PREFIX = "user:preference:";

    /**
     * 设置用户的推送偏好
     *
     * @param userId      用户ID
     * @param channel     推送方式 (如 "SmsNotificationChannel", "PushNotificationChannel")
     * @param userName    用户名称
     */
    @Override
    public void setUserPreference(Long userId, String channel, String userName) {
        Map<String, String> preferences = new HashMap<>();
        preferences.put("channel", channel);
        preferences.put("name", userName);
        redisUtils.set(USER_PREFERENCE_KEY_PREFIX + userId, preferences);
    }

    /**
     * 获取用户的推送偏好
     *
     * @param userId 用户ID
     * @return 推送偏好 Map，包含推送方式和用户名称
     */
    @Override
    public Map<String, String> getUserPreference(Long userId) {
        String json = redisUtils.get(USER_PREFERENCE_KEY_PREFIX + userId, String.class); // 获取 JSON 字符串
        if (json == null) {
            return null; // 如果没有值，返回 null 或默认值
        }

        try {
            // 将 JSON 字符串反序列化为 Map
            return objectMapper.readValue(json, new TypeReference<Map<String, String>>() {});
        } catch (Exception e) {
            throw new RuntimeException("无法解析用户偏好 JSON 数据", e);
        }
    }

    /**
     * 获取用户的推送渠道
     *
     * @param userId 用户ID
     * @return 推送渠道名称
     */
    @Override
    public String getUserPreferredChannel(Long userId) {
        Map<String, String> preferences = getUserPreference(userId);
        return preferences != null ? preferences.getOrDefault("channel", "SmsNotificationChannel") : "SmsNotificationChannel";
    }

    /**
     * 获取用户的名称
     *
     * @param userId 用户ID
     * @return 用户名称
     */
    @Override
    public String getUserName(Long userId) {
        Map<String, String> preferences = getUserPreference(userId);
        return preferences != null ? preferences.getOrDefault("name", "亲爱的用户") : "亲爱的用户";
    }
}
