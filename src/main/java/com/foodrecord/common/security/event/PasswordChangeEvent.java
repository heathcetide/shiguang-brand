package com.foodrecord.common.security.event;

/**
 * 密码变更事件
 * 
 * @author yourname
 * @since 1.0.0
 */
public class PasswordChangeEvent extends SecurityEvent {
    private final boolean success;
    private final String changeType;  // RESET/MODIFY
    
    public PasswordChangeEvent(Object source, Long userId, boolean success, 
            String changeType, String ipAddress) {
        super(source, userId, "PASSWORD_CHANGE", 
              String.format("密码%s%s", changeType, success ? "成功" : "失败"), ipAddress);
        this.success = success;
        this.changeType = changeType;
    }

    public boolean isSuccess() {
        return success;
    }

    public String getChangeType() {
        return changeType;
    }
}