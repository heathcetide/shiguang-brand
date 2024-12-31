package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;

public interface VideoWatermarkService {
    
    /**
     * 添加水印
     */
    ApiResponse addWatermark(Long videoId, String watermarkText, 
                           String position, Float opacity);
    
    /**
     * 更新水印
     */
    ApiResponse updateWatermark(Long watermarkId, String content, 
                              String position, Integer size, Float opacity);
    
    /**
     * 删除水印
     */
    ApiResponse deleteWatermark(Long watermarkId);
    
    /**
     * 获取视频水印列表
     */
    ApiResponse getVideoWatermarks(Long videoId);
    
    /**
     * 应用水印
     */
    ApiResponse applyWatermark(Long videoId, Long watermarkId);

    /**
     * 预览水印效果
     */
    ApiResponse previewWatermark(Long videoId, String watermarkText, String position);
} 