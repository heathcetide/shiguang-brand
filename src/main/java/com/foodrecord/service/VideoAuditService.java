package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;

public interface VideoAuditService {
    
    /**
     * 提交视频审核
     */
    ApiResponse submitAudit(Long videoId);
    
    /**
     * 审核视频
     */
    ApiResponse auditVideo(Long videoId, Integer status, String reason);
    
    /**
     * 获取视频审核记录
     */
    ApiResponse getAuditRecords(Long videoId);
    
    /**
     * 获取待审核视频列表
     */
    ApiResponse getPendingAuditList(Integer pageNum, Integer pageSize);

    ApiResponse getAuditStatus(Long videoId);
} 