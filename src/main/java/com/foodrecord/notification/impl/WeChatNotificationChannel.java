package com.foodrecord.notification.impl;

import com.foodrecord.notification.NotificationChannel;
import org.springframework.stereotype.Component;

@Component
public class WeChatNotificationChannel implements NotificationChannel {

    @Override
    public void sendTimingMessage(Long userId, String message) {
        String openId = getUserWeChatOpenId(userId);
        if (openId == null) {
            System.out.printf("用户 %d 未绑定微信 OpenId，无法发送微信消息%n", userId);
            return;
        }

        System.out.printf("微信消息推送给用户 %d: %s%n", userId, message);

        // 模拟调用微信模板消息 API
        sendWeChatTemplateMessage(openId, message);
    }

    private String getUserWeChatOpenId(Long userId) {
        // 模拟从数据库或缓存中获取用户微信 OpenId
        return "user_openid_example";
    }

    private void sendWeChatTemplateMessage(String openId, String message) {
        // 调用微信服务的模板消息 API，比如通过 access token 发送模板消息
        System.out.printf("通过微信 OpenId %s 发送模板消息: %s%n", openId, message);
    }
}
