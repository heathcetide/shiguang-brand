package com.foodrecord.service;

public interface MonitoringService {

    /**
     * 记录请求
     * @param method 请求方法
     * @param uri uri
     * @param params 请求参数
     * @param duration 时间
     */
    void logRequest(String method, String uri, String params, long duration);

    /**
     * 发送告警
     * @param message 告警信息
     */
    void alert(String message);
}
