package com.foodrecord.model.entity.user;

public class UserDeviceInfo {
    private String deviceId;
    private String deviceType;
    private String ipAddress;
    private String userAgent;

    public UserDeviceInfo(String deviceId, String deviceType, String ipAddress, String userAgent) {
        this.deviceId = deviceId;
        this.deviceType = deviceType;
        this.ipAddress = ipAddress;
        this.userAgent = userAgent;
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
}
