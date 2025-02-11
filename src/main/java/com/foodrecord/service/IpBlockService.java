package com.foodrecord.service;

import javax.servlet.http.HttpServletRequest;

public interface IpBlockService {

    /**
     * 检查指定 IP 是否被封禁
     *
     * @param ip 客户端 IP
     * @return true 表示被封禁；false 表示未被封禁
     */
    boolean isBlocked(String ip);

    /**
     * 记录异常访问（例如非法请求、异常行为等），超过阈值则封禁
     *
     * @param ip 客户端 IP
     */
    void recordAbnormalAccess(String ip);

    /**
     * 获取客户端真实 IP 地址，支持多级反向代理
     *
     * @param request HttpServletRequest 对象
     * @return 客户端 IP 地址
     */
    String getClientIp(HttpServletRequest request);

    /**
     * 获取某个 IP 当前的异常访问计数
     *
     * @param ip 客户端 IP
     * @return 异常访问计数，若无记录则返回 0
     */
    long getAttemptCount(String ip);

    /**
     * 重置指定 IP 的异常计数（例如：正常访问后重置计数）
     *
     * @param ip 客户端 IP
     */
    void resetAttempt(String ip);

    /**
     * 将 IP 添加到白名单
     *
     * @param ip 需要添加到白名单的 IP
     */
    void addToWhiteList(String ip);

    /**
     * 从白名单中移除 IP
     *
     * @param ip 需要移除的 IP
     */
    void removeFromWhiteList(String ip);

    /**
     * 查询 IP 是否在白名单中
     *
     * @param ip 需要查询的 IP
     * @return true 表示在白名单中，false 表示不在白名单中
     */
    boolean isInWhiteList(String ip);
}
