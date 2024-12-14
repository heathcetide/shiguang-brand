package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.entity.SensitiveOperationLog;

import javax.servlet.http.HttpServletRequest;
import java.util.List;

public interface SensitiveOperationLogService extends IService<SensitiveOperationLog> {
    void logOperation(Long userId, String operationType, String detail, HttpServletRequest request, String status, String failureReason);

    List<SensitiveOperationLog> getRecentLogs(Long userId);
}
