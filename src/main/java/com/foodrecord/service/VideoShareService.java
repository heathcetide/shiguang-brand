package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;

public interface VideoShareService {
    
    /**
     * 分享视频
     */
    ApiResponse shareVideo(Long videoId, Long userId, String platform);
    
    /**
     * 生成分享链接
     */
    ApiResponse generateShareLink(Long videoId, Long userId, String platform);
    
    /**
     * 获取视频分享记录
     */
    ApiResponse getVideoShares(Long videoId, Integer pageNum, Integer pageSize);
    
    /**
     * 获取用户分享记录
     */
    ApiResponse getUserShares(Long userId, Integer pageNum, Integer pageSize);
    
    /**
     * 获取分享统计
     */
    ApiResponse getShareStats(Long videoId);
} 