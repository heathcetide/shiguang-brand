package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;
import org.springframework.web.multipart.MultipartFile;

public interface VideoTranscodeService {
    
    /**
     * 提交转码任务
     */
    ApiResponse submitTranscode(Long videoId, String format);
    
    /**
     * 获取转码进度
     */
    ApiResponse getTranscodeProgress(String taskId);
    
    /**
     * 获取视频转码记录
     */
    ApiResponse getTranscodeRecords(Long videoId);
    
    /**
     * 取消转码任务
     */
    ApiResponse cancelTranscode(String taskId);

    ApiResponse uploadChunk(MultipartFile file, Integer chunkNumber, Integer totalChunks, String fileId);

    ApiResponse mergeChunks(String fileId, String fileName, Integer totalChunks);
} 