package com.foodrecord.constant;

public class VideoConstants {
    
    // 视频状态
    public static final int VIDEO_STATUS_DRAFT = 0;     // 草稿
    public static final int VIDEO_STATUS_PROCESSING = 1; // 处理中
    public static final int VIDEO_STATUS_NORMAL = 2;     // 正常
    public static final int VIDEO_STATUS_BLOCKED = 3;    // 封禁
    
    // 编辑任务状态
    public static final int EDIT_STATUS_PENDING = 0;    // 待处理
    public static final int EDIT_STATUS_PROCESSING = 1; // 处理中
    public static final int EDIT_STATUS_SUCCESS = 2;    // 成功
    public static final int EDIT_STATUS_FAILED = 3;     // 失败
    
    // 审核状态
    public static final int AUDIT_STATUS_PENDING = 0;   // 待审核
    public static final int AUDIT_STATUS_APPROVED = 1;  // 通过
    public static final int AUDIT_STATUS_REJECTED = 2;  // 拒绝
    
    // 视频处理相关常量
    public static final String[] ALLOWED_VIDEO_FORMATS = {".mp4", ".avi", ".mov", ".flv"};
    public static final long MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB
    public static final int MAX_VIDEO_DURATION = 3600; // 1小时
} 