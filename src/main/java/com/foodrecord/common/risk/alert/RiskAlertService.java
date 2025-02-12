//package com.foodrecord.common.risk.alert;
//
//import com.foodrecord.risk.enums.RiskLevel;
//import com.foodrecord.risk.model.RiskEvent;
//import org.springframework.data.redis.core.RedisTemplate;
//import org.springframework.stereotype.Service;
//
//import javax.annotation.Resource;
//import java.util.concurrent.TimeUnit;
//
//@Service
//public class RiskAlertService {
//
//    @Resource
//    private RedisTemplate<String, Object> redisTemplate;
//
//    private static final String ALERT_KEY = "risk:alert:";
//    private static final String ALERT_COUNTER = "risk:alert:counter:";
//    private static final int ALERT_WINDOW = 5; // 5分钟窗口
//    private static final int ALERT_THRESHOLD = 10; // 阈值
//
//    /**
//     * 处理风险事件并触发预警
//     */
//    public void processRiskEvent(RiskEvent event) {
//        // 1. 检查是否需要预警
//        if (shouldTriggerAlert(event)) {
//            // 2. 创建预警
//            RiskAlert alert = createAlert(event);
//
//            // 3. 发送预警
//            sendAlert(alert);
//
//            // 4. 更新预警计数
//            updateAlertCounter(event);
//        }
//    }
//
//    private boolean shouldTriggerAlert(RiskEvent event) {
//        // 1. 高风险事件直接触发
//        if (event.getLevel() == RiskLevel.HIGH) {
//            return true;
//        }
//
//        // 2. 检查频率
//        String counterKey = ALERT_COUNTER + event.getContext().getScenario();
//        Long count = redisTemplate.opsForValue().increment(counterKey, 1);
//        redisTemplate.expire(counterKey, ALERT_WINDOW, TimeUnit.MINUTES);
//
//        return count != null && count >= ALERT_THRESHOLD;
//    }
//
//    private RiskAlert createAlert(RiskEvent event) {
//        RiskAlert alert = new RiskAlert();
//        alert.setLevel(event.getLevel());
//        alert.setScenario(event.getContext().getScenario());
//        alert.setId(generateAlertId());
//        alert.setTimestamp(event.getTimestamp());
//        alert.setUserId(event.getContext().getUserId());
//        alert.setScore(event.getScore());
//        alert.setViolations(event.getViolations());
//        return alert;
//    }
//
//    private void sendAlert(RiskAlert alert) {
//        // 1. 保存预警
//        String key = ALERT_KEY + alert.getId();
//        redisTemplate.opsForValue().set(key, alert);
//        redisTemplate.expire(key, 7, TimeUnit.DAYS);
//
//        // 2. 发送通知
//        sendNotification(alert);
//
//        // 3. 触发自动响���
//        triggerAutoResponse(alert);
//    }
//
//    private void sendNotification(RiskAlert alert) {
//        // TODO: 实现多渠道通知(邮件、短信、webhook等)
//    }
//
//    private void triggerAutoResponse(RiskAlert alert) {
//        // TODO: 实现自动响应策略
//    }
//
//    private String generateAlertId() {
//        return "ALERT-" + System.currentTimeMillis();
//    }
//
//    private void updateAlertCounter(RiskEvent event) {
//        String key = ALERT_COUNTER + event.getContext().getScenario();
//        redisTemplate.opsForValue().increment(key, 1);
//        redisTemplate.expire(key, ALERT_WINDOW, TimeUnit.MINUTES);
//    }
//}