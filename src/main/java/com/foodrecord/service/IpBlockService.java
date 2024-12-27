package com.foodrecord.service;

import javax.servlet.http.HttpServletRequest;

public interface IpBlockService {
    boolean isBlocked(String ip);

    void recordAbnormalAccess(String ip);

    String getClientIp(HttpServletRequest request);
}
