package com.foodrecord.controller.user;

import com.foodrecord.notification.NotificationService;
import com.foodrecord.service.UserPreferenceService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.web.bind.annotation.*;
import javax.annotation.Resource;
import java.util.Map;

/**
 * 用户偏好设置模块控制器，提供用户推送偏好的获取、设置以及测试通知发送功能。
 */
@RestController
@RequestMapping("/api/preferences")
@Api(tags = "用户偏好设置模块")
public class UserPreferenceController {

    @Resource
    private UserPreferenceService userPreferenceService;

    @Resource
    private NotificationService notificationService;

    /**
     * 获取用户推送偏好
     *
     * @param userId 用户ID，用于查询用户的推送偏好设置
     * @return 返回用户的偏好设置，以键值对的形式
     */
    @GetMapping("/{userId}")
    @ApiOperation(value = "获取用户推送偏好", notes = "根据用户 ID 获取用户的推送偏好设置")
    public Map<String, String> getUserPreferences(
            @ApiParam(value = "用户的唯一标识ID", required = true) @PathVariable Long userId) {
        // 调用服务层方法获取用户的偏好设置
        return userPreferenceService.getUserPreference(userId);
    }

    /**
     * 修改用户推送偏好
     *
     * @param userId   用户ID，用于标识需要更新偏好的用户
     * @param channel  推送方式（例如：短信、邮件、推送通知等）
     * @param userName 用户名称，用于更新推送偏好中的用户名称
     * @return 返回更新成功的提示信息
     */
    @PostMapping("/{userId}")
    @ApiOperation(value = "修改用户推送偏好", notes = "根据用户 ID 和推送方式修改用户的偏好设置")
    public String setUserPreferences(
            @ApiParam(value = "用户的唯一标识ID", required = true) @PathVariable Long userId,
            @ApiParam(value = "推送方式（例如：短信、邮件等）", required = true) @RequestParam String channel,
            @ApiParam(value = "用户名称，用于更新推送偏好", required = true) @RequestParam String userName) {
        // 调用服务层方法设置用户的偏好
        userPreferenceService.setUserPreference(userId, channel, userName);
        return "推送偏好已更新";
    }

    /**
     * 测试通知发送
     *
     * @param userId  用户ID，用于确定通知的接收对象
     * @param message 消息内容，表示要发送的通知内容
     * @return 返回通知发送成功的提示信息
     */
    @GetMapping("/test/{userId}")
    @ApiOperation(value = "测试通知发送", notes = "根据用户的推送偏好测试发送通知")
    public String testNotification(
            @ApiParam(value = "用户的唯一标识ID", required = true) @PathVariable Long userId,
            @ApiParam(value = "要发送的消息内容", required = true) @RequestParam String message) {
        // 调用通知服务，根据用户的推送偏好发送通知
        notificationService.sendNotificationBasedOnPreference(userId, message);
        return "通知已发送";
    }
}
