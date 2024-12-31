package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;

public interface VideoQualityService {
    
    /**
     * 生成不同清晰度的视频
     */
    ApiResponse generateQualities(Long videoId, String[] qualities);
    
    /**
     * 获取视频的所有清晰度
     */
    ApiResponse getVideoQualities(Long videoId);
    
    /**
     * 获取指定清晰度的视频URL
     */
    ApiResponse getQualityUrl(Long videoId, String quality);
    
    /**
     * 删除指定清晰度的视频
     */
    ApiResponse deleteQuality(Long videoId, String quality);
    
    /**
     * 获取转码进度
     */
    ApiResponse getTranscodeProgress(Long videoId, String quality);

    /**
     * 获取可用的清晰度列表
     */
    ApiResponse getAvailableQualities(Long videoId);

    /**
     * 获取视频URL
     */
    ApiResponse getVideoUrl(Long videoId, String quality);
} 