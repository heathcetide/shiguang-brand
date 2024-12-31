package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;

public interface VideoReportService {
    
    /**
     * 举报视频
     */
    ApiResponse reportVideo(Long videoId, Long userId, String reason, String description);
    
    /**
     * 获取举报状态
     */
    ApiResponse getReportStatus(Long reportId);
    
    /**
     * 处理举报
     */
    ApiResponse handleReport(Long reportId, Integer status, String feedback);
    
    /**
     * 获取用户举报记录
     */
    ApiResponse getUserReports(Long userId, Integer pageNum, Integer pageSize);
    
    /**
     * 获取视频举报记录
     */
    ApiResponse getVideoReports(Long videoId, Integer pageNum, Integer pageSize);
} 