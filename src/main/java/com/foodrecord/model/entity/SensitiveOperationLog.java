package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import java.time.LocalDateTime;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

@ApiModel(description = "敏感操作日志实体")
@TableName("sensitive_operation_logs")
public class SensitiveOperationLog extends BaseEntity {

    @ApiModelProperty(value = "日志ID", example = "1")
    @TableId(type = IdType.AUTO)
    private Long id;

    @ApiModelProperty(value = "用户ID", example = "10001")
    @TableField("user_id")
    private Long userId;

    @ApiModelProperty(value = "操作类型（如 PASSWORD_CHANGE, ROLE_CHANGE, PERMISSION_CHANGE）", example = "PASSWORD_CHANGE")
    @TableField("operation_type")
    private String operationType;

    @ApiModelProperty(value = "操作详情", example = "用户密码更新")
    @TableField("operation_detail")
    private String operationDetail;

    @ApiModelProperty(value = "操作时间", example = "2024-12-16T12:00:00")
    @TableField("operation_time")
    private LocalDateTime operationTime;

    @ApiModelProperty(value = "IP地址", example = "192.168.1.1")
    @TableField("ip_address")
    private String ipAddress;

    @ApiModelProperty(value = "用户代理", example = "Mozilla/5.0")
    @TableField("user_agent")
    private String userAgent;

    @ApiModelProperty(value = "操作状态", example = "SUCCESS")
    @TableField("status")
    private String status;

    @ApiModelProperty(value = "失败原因", example = "权限不足")
    @TableField("failure_reason")
    private String failureReason;

    @ApiModelProperty(value = "关联的用户实体")
    @TableField(exist = false)
    private User user;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public String getOperationType() {
        return operationType;
    }

    public void setOperationType(String operationType) {
        this.operationType = operationType;
    }

    public String getOperationDetail() {
        return operationDetail;
    }

    public void setOperationDetail(String operationDetail) {
        this.operationDetail = operationDetail;
    }

    public LocalDateTime getOperationTime() {
        return operationTime;
    }

    public void setOperationTime(LocalDateTime operationTime) {
        this.operationTime = operationTime;
    }

    public String getIpAddress() {
        return ipAddress;
    }

    public void setIpAddress(String ipAddress) {
        this.ipAddress = ipAddress;
    }

    public String getUserAgent() {
        return userAgent;
    }

    public void setUserAgent(String userAgent) {
        this.userAgent = userAgent;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getFailureReason() {
        return failureReason;
    }

    public void setFailureReason(String failureReason) {
        this.failureReason = failureReason;
    }

    public User getUser() {
        return user;
    }

    public void setUser(User user) {
        this.user = user;
    }
}