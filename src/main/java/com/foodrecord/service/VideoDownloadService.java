package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;

public interface VideoDownloadService {
    
    /**
     * 生成下载链接
     */
    ApiResponse generateDownloadUrl(Long videoId, Long userId, String quality);
    
    /**
     * 开始下载
     */
    ApiResponse startDownload(Long videoId, Long userId, String quality);
    
    /**
     * 获取下载进度
     */
    ApiResponse getDownloadProgress(Long downloadId);
    
    /**
     * 取消下载
     */
    ApiResponse cancelDownload(Long downloadId);
    
    /**
     * 获取用户下载记录
     */
    ApiResponse getUserDownloads(Long userId, Integer pageNum, Integer pageSize);
    
    /**
     * 获取视频下载统计
     */
    ApiResponse getDownloadStats(Long videoId);

    ApiResponse requestDownload(Long videoId, Long userId, String quality);

    ApiResponse getDownloadUrl(Long downloadId);
} 