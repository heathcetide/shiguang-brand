package com.foodrecord.notification.impl;

import com.foodrecord.model.entity.Notification;
import com.foodrecord.notification.SendNotifyStrategy;
import com.aliyuncs.DefaultAcsClient;
import com.aliyuncs.profile.DefaultProfile;
import com.aliyuncs.dysmsapi.model.v20170525.SendSmsRequest;
import com.aliyuncs.dysmsapi.model.v20170525.SendSmsResponse;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
@Qualifier("smsStrategy")
public class SmsSendNotification implements SendNotifyStrategy {

    // 从配置文件中获取阿里云的 AccessKey 和 SecretKey
    @Value("${aliyun.sms.accessKeyId:your-access-key-id}")
    private String accessKeyId;

    @Value("${aliyun.sms.accessKeySecret:your-access-key-secret}")
    private String accessKeySecret;

    private static final String REGION_ID = "cn-hangzhou"; // 根据区域选择

    @Override
    public void send(Notification notification) {
        try {
            // 获取用户的手机号并发送短信
            String phoneNumber = notification.getUserId().toString(); // 假设根据用户ID找到手机号
            sendMessage(phoneNumber, notification.getContent(),null);
        } catch (Exception e) {
            throw new RuntimeException("发送短信通知失败", e);
        }
    }

    @Override
    public void sendMessage(String to, String message, String body) throws Exception {
        DefaultProfile profile = DefaultProfile.getProfile(REGION_ID, accessKeyId, accessKeySecret);
        DefaultAcsClient client = new DefaultAcsClient(profile);

        SendSmsRequest request = new SendSmsRequest();
        request.setPhoneNumbers(to);  // 用户的手机号
        request.setSignName("食光烙记");
        request.setTemplateCode("SMS_123456789");
        request.setTemplateParam("{\"message\":\"" + message + "\"}");

        SendSmsResponse response = client.getAcsResponse(request);

        if ("OK".equals(response.getCode())) {
            System.out.println("短信发送成功");
        } else {
            System.out.println("短信发送失败: " + response.getMessage());
        }
    }

    @Override
    public void sendWelcomeMessage(String to, String username) throws Exception {
        // 短信欢迎消息
        String message = "欢迎加入食光烙记, " + username + "!";
        sendMessage(to, message,null);
    }

    @Override
    public void sendRegisterCodeMessage(String to, String code) throws Exception {
        // 短信验证码
        String message = "您的注册验证码是: " + code;
        sendMessage(to, message,null);
    }
}
