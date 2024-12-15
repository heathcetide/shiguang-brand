package com.foodrecord.common.security.event;

/**
 * 权限变更事件
 * 
 * @author yourname
 * @since 1.0.0
 */
public class PermissionChangeEvent extends SecurityEvent {
    private final String operation;  // GRANT/REVOKE
    private final String permission;
    private final Long targetUserId;
    
    public PermissionChangeEvent(Object source, Long operatorId, String operation, 
            String permission, Long targetUserId, String ipAddress) {
        super(source, operatorId, "PERMISSION_CHANGE", 
              String.format("%s权限 %s 给用户 %d", operation, permission, targetUserId), ipAddress);
        this.operation = operation;
        this.permission = permission;
        this.targetUserId = targetUserId;
    }

    public String getOperation() {
        return operation;
    }

    public String getPermission() {
        return permission;
    }

    public Long getTargetUserId() {
        return targetUserId;
    }
}