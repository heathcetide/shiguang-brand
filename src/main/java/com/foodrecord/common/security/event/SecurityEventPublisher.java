package com.foodrecord.common.security.event;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * 安全事件发布器
 * 用于在系统中发布各种安全事件
 * 
 * @author yourname
 * @since 1.0.0
 */
@Component
public class SecurityEventPublisher {
    private final ApplicationEventPublisher eventPublisher;

    public SecurityEventPublisher(ApplicationEventPublisher eventPublisher) {
        this.eventPublisher = eventPublisher;
    }

    /**
     * 发布登录事件
     */
    public void publishLoginEvent(Long userId, boolean success, String failureReason, String ipAddress) {
        eventPublisher.publishEvent(new LoginEvent(this, userId, success, failureReason, ipAddress));
    }
    
    /**
     * 发布权限变更事件
     */
    public void publishPermissionChangeEvent(Long operatorId, String operation, 
            String permission, Long targetUserId, String ipAddress) {
        eventPublisher.publishEvent(new PermissionChangeEvent(this, operatorId, 
            operation, permission, targetUserId, ipAddress));
    }
    
    /**
     * 发布密码变更事件
     */
    public void publishPasswordChangeEvent(Long userId, boolean success, String changeType, String ipAddress) {
        eventPublisher.publishEvent(new PasswordChangeEvent(this, userId, success, changeType, ipAddress));
    }
    
    /**
     * 发布账户状态变更事件
     */
    public void publishAccountStatusEvent(Long userId, String oldStatus, String newStatus, 
            String reason, String ipAddress) {
        eventPublisher.publishEvent(new AccountStatusEvent(this, userId, oldStatus, newStatus, 
            reason, ipAddress));
    }
    
    /**
     * 发布敏感操作事件
     */
    public void publishSensitiveOperationEvent(Long userId, String operationType, 
            String targetResource, String result, String ipAddress) {
        eventPublisher.publishEvent(new SensitiveOperationEvent(this, userId, operationType, 
            targetResource, result, ipAddress));
    }
} 