package com.foodrecord.constant;

/**
 * 视频常量
 */
public interface VideoConstants {
    
    // 视频状态
    int VIDEO_STATUS_DRAFT = 0;     // 草稿
    int VIDEO_STATUS_PROCESSING = 1; // 处理中
    int VIDEO_STATUS_NORMAL = 2;     // 正常
    int VIDEO_STATUS_BLOCKED = 3;    // 封禁
    
    // 编辑任务状态
    int EDIT_STATUS_PENDING = 0;    // 待处理
    int EDIT_STATUS_PROCESSING = 1; // 处理中
    int EDIT_STATUS_SUCCESS = 2;    // 成功
    int EDIT_STATUS_FAILED = 3;     // 失败
    
    // 审核状态
    int AUDIT_STATUS_PENDING = 0;   // 待审核
    int AUDIT_STATUS_APPROVED = 1;  // 通过
    int AUDIT_STATUS_REJECTED = 2;  // 拒绝
    
    // 视频处理相关常量
    String[] ALLOWED_VIDEO_FORMATS = {".mp4", ".avi", ".mov", ".flv"};
    long MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB
    int MAX_VIDEO_DURATION = 3600; // 1小时
}

