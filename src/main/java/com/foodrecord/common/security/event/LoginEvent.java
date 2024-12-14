package com.foodrecord.common.security.event;


/**
 * 登录事件
 * 
 * @author yourname
 * @since 1.0.0
 */
public class LoginEvent extends SecurityEvent {
    private final boolean success;
    private final String failureReason;
    
    public LoginEvent(Object source, Long userId, boolean success, String failureReason, String ipAddress) {
        super(source, userId, "LOGIN", success ? "登录成功" : "登录失败: " + failureReason, ipAddress);
        this.success = success;
        this.failureReason = failureReason;
    }

    public boolean isSuccess() {
        return success;
    }

    public String getFailureReason() {
        return failureReason;
    }
}