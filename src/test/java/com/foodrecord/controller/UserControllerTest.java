package com.foodrecord.controller;

import com.foodrecord.common.utils.RedisUtils;
import com.foodrecord.model.entity.User;
import com.foodrecord.notification.impl.EmailNotificationSender;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import javax.annotation.Resource;
import javax.mail.MessagingException;

@SpringBootTest
public class UserControllerTest {
    @Resource
    private RedisUtils redisUtils;

    private static final String USER_CACHE_KEY = "user:";
    private static final long USER_CACHE_TIME = 3600; // 1小时

    @Test
    public void testRegister(){
        User user = new User();
        user.setId(13L);
        redisUtils.set(USER_CACHE_KEY + user.getId(), user, USER_CACHE_TIME);
    }


    @Resource
    private EmailNotificationSender emailService;

    @Test
    public void testSendEmail() throws MessagingException {
        User user = new User();
        user.setId(13L);
        emailService.sendEmail("2148582258@qq.com","进行邮件测试","" +
                "<!DOCTYPE html>\n" +
                "<html lang=\"zh\">\n" +
                "<head>\n" +
                "    <meta charset=\"UTF-8\">\n" +
                "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n" +
                "    <title>秦始皇的召唤</title>\n" +
                "    <style>\n" +
                "        body {\n" +
                "            font-family: \"Microsoft YaHei\", Arial, sans-serif;\n" +
                "            background: linear-gradient(to right, #f0f0f0, #d9e9f9);\n" +
                "            color: #333;\n" +
                "            margin: 0;\n" +
                "            padding: 0;\n" +
                "            display: flex;\n" +
                "            justify-content: center;\n" +
                "            align-items: center;\n" +
                "            height: 100vh;\n" +
                "        }\n" +
                "        .container {\n" +
                "            max-width: 700px;\n" +
                "            background-color: #fff;\n" +
                "            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);\n" +
                "            border-radius: 10px;\n" +
                "            padding: 20px;\n" +
                "            text-align: center;\n" +
                "            animation: fadeIn 1s ease-in-out;\n" +
                "        }\n" +
                "        h1 {\n" +
                "            color: #d35400;\n" +
                "            font-size: 2em;\n" +
                "            margin-bottom: 10px;\n" +
                "            text-shadow: 2px 2px 5px #f39c12;\n" +
                "        }\n" +
                "        p {\n" +
                "            line-height: 1.8;\n" +
                "            font-size: 1.1em;\n" +
                "            margin: 15px 0;\n" +
                "        }\n" +
                "        .highlight {\n" +
                "            font-weight: bold;\n" +
                "            color: #e74c3c;\n" +
                "        }\n" +
                "        .footer {\n" +
                "            margin-top: 20px;\n" +
                "            font-size: 0.9em;\n" +
                "            color: #555;\n" +
                "        }\n" +
                "        @keyframes fadeIn {\n" +
                "            from { opacity: 0; transform: translateY(-20px); }\n" +
                "            to { opacity: 1; transform: translateY(0); }\n" +
                "        }\n" +
                "    </style>\n" +
                "</head>\n" +
                "<body>\n" +
                "    <div class=\"container\">\n" +
                "        <h1>秦始皇的召唤</h1>\n" +
                "        <p>我是 <span class=\"highlight\">秦始皇</span>，其实我没有死！</p>\n" +
                "        <p>我在 <span class=\"highlight\">西安兵马俑第三个坑第六排</span>，告诉你啊，我在陕西有 <span class=\"highlight\">3000吨黄金</span> 和 <span class=\"highlight\">300万秦兵</span> 被封印！</p>\n" +
                "        <p>现在只需要 <span class=\"highlight\">2000元</span> 就能解封，支付宝、微信都可以，账号就是我的手机号！</p>\n" +
                "        <p>只要你打钱给我，待我解封之日，我就收你当干儿子，立你为 <span class=\"highlight\">太子</span>！<br><span class=\"highlight\">君无戏言！</span></p>\n" +
                "        <div class=\"footer\">© 2024 秦始皇 | 臣服与荣耀</div>\n" +
                "    </div>\n" +
                "</body>\n" +
                "</html>\n");
    }

    @Test
    public void testTemplateSendEmail() throws MessagingException {
        emailService.sendWelcomeEmail("2148582258@qq.com","cetide");
    }
}
