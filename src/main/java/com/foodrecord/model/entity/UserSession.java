package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

import java.time.LocalDateTime;

@ApiModel(description = "用户会话信息实体")
@TableName("user_sessions")
public class UserSession extends BaseEntity {

    @ApiModelProperty(value = "会话ID", example = "12345")
    @TableId(type = IdType.AUTO)
    private Long id;

    @ApiModelProperty(value = "用户ID", example = "67890")
    @TableField("user_id")
    private Long userId;

    @ApiModelProperty(value = "会话令牌", example = "abcd1234")
    @TableField("session_token")
    private String sessionToken;

    @ApiModelProperty(value = "刷新令牌", example = "efgh5678")
    @TableField("refresh_token")
    private String refreshToken;

    @ApiModelProperty(value = "设备ID", example = "device123")
    @TableField("device_id")
    private String deviceId;

    @ApiModelProperty(value = "设备类型", example = "mobile")
    @TableField("device_type")
    private String deviceType;

    @ApiModelProperty(value = "IP地址", example = "192.168.1.1")
    @TableField("ip_address")
    private String ipAddress;

    @ApiModelProperty(value = "用户代理信息", example = "Mozilla/5.0")
    @TableField("user_agent")
    private String userAgent;

    @ApiModelProperty(value = "会话过期时间", example = "2024-12-31T23:59:59")
    @TableField("expires_at")
    private LocalDateTime expiresAt;

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

    public String getSessionToken() {
        return sessionToken;
    }

    public void setSessionToken(String sessionToken) {
        this.sessionToken = sessionToken;
    }

    public String getRefreshToken() {
        return refreshToken;
    }

    public void setRefreshToken(String refreshToken) {
        this.refreshToken = refreshToken;
    }

    public String getDeviceId() {
        return deviceId;
    }

    public void setDeviceId(String deviceId) {
        this.deviceId = deviceId;
    }

    public String getDeviceType() {
        return deviceType;
    }

    public void setDeviceType(String deviceType) {
        this.deviceType = deviceType;
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

    public LocalDateTime getExpiresAt() {
        return expiresAt;
    }

    public void setExpiresAt(LocalDateTime expiresAt) {
        this.expiresAt = expiresAt;
    }

    public User getUser() {
        return user;
    }

    public void setUser(User user) {
        this.user = user;
    }
}