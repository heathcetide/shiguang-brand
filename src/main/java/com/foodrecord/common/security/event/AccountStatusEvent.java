package com.foodrecord.common.security.event;


/**
 * 账户状态变更事件
 * 
 * @author yourname
 * @since 1.0.0
 */
public class AccountStatusEvent extends SecurityEvent {
    private final String oldStatus;
    private final String newStatus;
    private final String reason;
    
    public AccountStatusEvent(Object source, Long userId, String oldStatus, 
            String newStatus, String reason, String ipAddress) {
        super(source, userId, "ACCOUNT_STATUS", 
              String.format("账户状态从%s变更为%s，原因：%s", oldStatus, newStatus, reason), ipAddress);
        this.oldStatus = oldStatus;
        this.newStatus = newStatus;
        this.reason = reason;
    }

    public String getOldStatus() {
        return oldStatus;
    }

    public String getNewStatus() {
        return newStatus;
    }

    public String getReason() {
        return reason;
    }
}