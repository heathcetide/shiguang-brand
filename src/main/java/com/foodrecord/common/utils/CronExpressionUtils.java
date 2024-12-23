package com.foodrecord.common.utils;

import org.springframework.util.StringUtils;

public class CronExpressionUtils {

    /**
     * 根据小时和分钟生成 Cron 表达式
     *
     * @param hour   小时 (0-23)
     * @param minute 分钟 (0-59)
     * @return 生成的 Cron 表达式 (例如 "0 30 6 * * ?")
     * @throws IllegalArgumentException 如果小时或分钟不合法
     */
    public static String generateCronExpression(int hour, int minute) {
        if (hour < 0 || hour > 23) {
            throw new IllegalArgumentException("小时 (hour) 必须在 0 到 23 之间");
        }
        if (minute < 0 || minute > 59) {
            throw new IllegalArgumentException("分钟 (minute) 必须在 0 到 59 之间");
        }
        return String.format("0 %d %d * * ?", minute, hour);
    }

    /**
     * 根据具体时间字符串生成 Cron 表达式
     *
     * @param time 时间字符串 (格式: "HH:mm"，例如 "06:30")
     * @return 生成的 Cron 表达式
     * @throws IllegalArgumentException 如果时间格式不正确
     */
    public static String generateCronExpression(String time) {
        if (!StringUtils.hasText(time) || !time.matches("^([01]?\\d|2[0-3]):([0-5]?\\d)$")) {
            throw new IllegalArgumentException("时间格式不正确，请使用 HH:mm 格式，例如 '06:30'");
        }
        String[] parts = time.split(":");
        int hour = Integer.parseInt(parts[0]);
        int minute = Integer.parseInt(parts[1]);
        return generateCronExpression(hour, minute);
    }

    /**
     * 验证 Cron 表达式是否有效
     *
     * @param cron Cron 表达式
     * @return 是否有效
     */
    public static boolean validateCronExpression(String cron) {
        // 简单校验 Cron 格式
        return StringUtils.hasText(cron) && cron.matches("^\\d+ \\d+ \\d+ \\* \\* \\?$");
    }
}
