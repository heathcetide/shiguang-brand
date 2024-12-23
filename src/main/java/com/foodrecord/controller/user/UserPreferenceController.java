package com.foodrecord.controller.user;

import com.foodrecord.notification.NotificationService;
import com.foodrecord.service.UserPreferenceService;
import io.swagger.annotations.Api;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/preferences")
@Api(tags = "用户偏好设置模块")
public class UserPreferenceController {

    @Autowired
    private UserPreferenceService userPreferenceService;

    @Autowired
    private NotificationService notificationService;

    /**
     * 获取用户推送偏好
     *
     * @param userId 用户ID
     * @return 用户偏好
     */
    @GetMapping("/{userId}")
    public Map<String, String> getUserPreferences(@PathVariable Long userId) {
        return userPreferenceService.getUserPreference(userId);
    }

    /**
     * 修改用户推送偏好
     *
     * @param userId      用户ID
     * @param channel     推送方式
     * @param userName    用户名称
     */
    @PostMapping("/{userId}")
    public String setUserPreferences(
            @PathVariable Long userId,
            @RequestParam String channel,
            @RequestParam String userName) {
        userPreferenceService.setUserPreference(userId, channel, userName);
        return "推送偏好已更新";
    }

    /**
     * 测试通知发送
     *
     * @param userId  用户ID
     * @param message 消息内容
     */
    @GetMapping("/test/{userId}")
    public String testNotification(@PathVariable Long userId, @RequestParam String message) {
        notificationService.sendNotificationBasedOnPreference(userId, message);
        return "通知已发送";
    }
}
