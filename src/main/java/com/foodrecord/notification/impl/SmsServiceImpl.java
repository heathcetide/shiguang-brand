package com.foodrecord.notification.impl;

import com.aliyun.teaopenapi.models.Config;
import com.aliyun.dysmsapi20170525.Client;
import com.aliyun.dysmsapi20170525.models.SendSmsRequest;
import com.aliyun.dysmsapi20170525.models.SendSmsResponse;
import static com.aliyun.teautil.Common.toJSONString;

import com.foodrecord.notification.SmsService;
import org.springframework.stereotype.Service;

@Service("implSmsNotificationChannel")
public class SmsServiceImpl implements SmsService {

    public static Client createClient() throws Exception {
        Config config = new Config()
                // 配置 AccessKey ID，请确保代码运行环境设置了环境变量 ALIBABA_CLOUD_ACCESS_KEY_ID。
                .setAccessKeyId(System.getenv("ALIBABA_CLOUD_ACCESS_KEY_ID"))
                // 配置 AccessKey Secret，请确保代码运行环境设置了环境变量 ALIBABA_CLOUD_ACCESS_KEY_SECRET。
                .setAccessKeySecret(System.getenv("ALIBABA_CLOUD_ACCESS_KEY_SECRET"));

        // 配置 Endpoint
        config.endpoint = "dysmsapi.aliyuncs.com";

        return new Client(config);
    }

    /**
     * 发送短信
     * @param phoneNumber 接收短信的手机号
     * @param message 验证码或短信内容
     */
    @Override
    public void sendSms(String phoneNumber, String message) {
        try {
            // 初始化请求客户端
            Client client = SmsServiceImpl.createClient();

            // 构造请求对象，请填入请求参数值
            SendSmsRequest sendSmsRequest = new SendSmsRequest()
                    .setPhoneNumbers("1390000****")
                    .setSignName("阿里云")
                    .setTemplateCode("SMS_15305****")
                    .setTemplateParam("{\"name\":\"张三\",\"number\":\"1390000****\"}");

            // 获取响应对象
            SendSmsResponse sendSmsResponse = client.sendSms(sendSmsRequest);

            // 响应包含服务端响应的 body 和 headers
            System.out.println(toJSONString(sendSmsResponse));
        }catch (Exception e){
            e.printStackTrace();
        }
    }
}
