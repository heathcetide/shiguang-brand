package com.foodrecord.common.utils;

import java.awt.*;
import java.awt.image.BufferedImage;
import java.util.Random;

public class CaptchaUtils {
    /**
     *     // region 登录相关
     *     @GetMapping("/captcha")
     *     public void getCaptcha(HttpSession session, HttpServletResponse response) throws IOException {
     *         String sessionId = session.getId();
     *         System.out.println("Session ID (getCaptcha): " + sessionId);
     *         String captchaText = CaptchaUtils.generateCaptchaText(6);
     *         System.out.println("Generated Captcha Text: " + captchaText);
     *         session.setAttribute("captcha", captchaText);
     *
     *         // 生成验证码图片
     *         BufferedImage image = CaptchaUtils.generateCaptchaImage(captchaText);
     *         response.setContentType("image/png");
     *         response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate"); // 禁用缓存
     *         response.setHeader("Pragma", "no-cache");
     *         response.setDateHeader("Expires", 0);
     *         // 将图片写入响应流
     *         ImageIO.write(image, "png", response.getOutputStream());
     *     }
     *
     *     @PostMapping("/verify-captcha")
     *     public BaseResponse<Boolean> verifyCaptcha(@RequestBody Map<String, String> request, HttpSession session) {
     *         String sessionId = session.getId();
     *         System.out.println("Session ID (verifyCaptcha): " + sessionId);
     *         String userCaptcha = request.get("captcha");
     *         String sessionCaptcha = (String) session.getAttribute("captcha");
     *         System.out.println("User Captcha: " + userCaptcha + " Session Captcha: " + sessionCaptcha);
     *         boolean success = userCaptcha != null && userCaptcha.equalsIgnoreCase(sessionCaptcha);
     *         System.out.println("Verification Result: " + success);
     *         return ResultUtils.success(success);
     *     }
     * @param length
     * @return
     */

    // 生成随机验证码文本
    public static String generateCaptchaText(int length) {
        String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        StringBuilder sb = new StringBuilder();
        Random random = new Random();
        for (int i = 0; i < length; i++) {
            sb.append(chars.charAt(random.nextInt(chars.length())));
        }
        return sb.toString();
    }

    // 生成验证码图片
    public static BufferedImage generateCaptchaImage(String captchaText) {
        int width = 160, height = 40;
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();

        // 设置背景色
        g.setColor(Color.LIGHT_GRAY);
        g.fillRect(0, 0, width, height);

        // 设置字体和颜色
        g.setFont(new Font("Arial", Font.BOLD, 30));
        g.setColor(Color.BLACK);
        g.drawString(captchaText, 20, 30);

        // 添加干扰线
        Random random = new Random();
        for (int i = 0; i < 5; i++) {
            g.setColor(new Color(random.nextInt(255), random.nextInt(255), random.nextInt(255)));
            int x1 = random.nextInt(width);
            int y1 = random.nextInt(height);
            int x2 = random.nextInt(width);
            int y2 = random.nextInt(height);
            g.drawLine(x1, y1, x2, y2);
        }
        g.dispose();
        return image;
    }
}
