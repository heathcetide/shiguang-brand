package com.foodrecord.risk.alert;

import com.foodrecord.risk.enums.RiskLevel;
import com.foodrecord.risk.model.RiskViolation;
import java.util.List;


public class RiskAlert {
    private String id;
    private RiskLevel level;
    private String scenario;
    private Long userId;
    private double score;
    private List<RiskViolation> violations;
    private long timestamp;
    private AlertStatus status;
    private String notificationChannel;
    private String responseAction;
    
    public enum AlertStatus {
        NEW,        // 新建
        NOTIFIED,   // 已通知
        PROCESSED,  // 已处理
        IGNORED,    // 已忽略
        CLOSED      // 已关闭
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public RiskLevel getLevel() {
        return level;
    }

    public void setLevel(RiskLevel level) {
        this.level = level;
    }

    public String getScenario() {
        return scenario;
    }

    public void setScenario(String scenario) {
        this.scenario = scenario;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public double getScore() {
        return score;
    }

    public void setScore(double score) {
        this.score = score;
    }

    public List<RiskViolation> getViolations() {
        return violations;
    }

    public void setViolations(List<RiskViolation> violations) {
        this.violations = violations;
    }

    public long getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(long timestamp) {
        this.timestamp = timestamp;
    }

    public AlertStatus getStatus() {
        return status;
    }

    public void setStatus(AlertStatus status) {
        this.status = status;
    }

    public String getNotificationChannel() {
        return notificationChannel;
    }

    public void setNotificationChannel(String notificationChannel) {
        this.notificationChannel = notificationChannel;
    }

    public String getResponseAction() {
        return responseAction;
    }

    public void setResponseAction(String responseAction) {
        this.responseAction = responseAction;
    }
}