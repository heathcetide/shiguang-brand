package com.foodrecord.common.security.event;


/**
 * 敏感操作事件
 * 
 * @author yourname
 * @since 1.0.0
 */
public class SensitiveOperationEvent extends SecurityEvent {
    private final String operationType;
    private final String targetResource;
    private final String result;
    
    public SensitiveOperationEvent(Object source, Long userId, String operationType, 
            String targetResource, String result, String ipAddress) {
        super(source, userId, "SENSITIVE_OPERATION", 
              String.format("对%s执行%s操作，结果：%s", targetResource, operationType, result), ipAddress);
        this.operationType = operationType;
        this.targetResource = targetResource;
        this.result = result;
    }

    public String getOperationType() {
        return operationType;
    }

    public String getTargetResource() {
        return targetResource;
    }

    public String getResult() {
        return result;
    }
}