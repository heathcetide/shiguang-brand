package com.foodrecord.common.security;

/**
 * 审计操作类型枚举
 * 定义了系统中所有需要审计的操作类型
 * 
 * @author yourname
 * @since 1.0.0
 */
public class AuditOperations {
    // 用户相关操作
    public static final String USER_LOGIN = "USER_LOGIN";
    public static final String USER_LOGOUT = "USER_LOGOUT";
    public static final String USER_REGISTER = "USER_REGISTER";
    public static final String USER_UPDATE = "USER_UPDATE";
    public static final String USER_DELETE = "USER_DELETE";
    public static final String USER_CHANGE_PASSWORD = "USER_CHANGE_PASSWORD";
    
    // 权限相关操作
    public static final String ROLE_ASSIGN = "ROLE_ASSIGN";
    public static final String ROLE_REVOKE = "ROLE_REVOKE";
    public static final String PERMISSION_GRANT = "PERMISSION_GRANT";
    public static final String PERMISSION_REVOKE = "PERMISSION_REVOKE";
    
    // 数据相关操作
    public static final String DATA_CREATE = "DATA_CREATE";
    public static final String DATA_UPDATE = "DATA_UPDATE";
    public static final String DATA_DELETE = "DATA_DELETE";
    public static final String DATA_EXPORT = "DATA_EXPORT";
    public static final String DATA_IMPORT = "DATA_IMPORT";
    
    // 系统相关操作
    public static final String SYSTEM_CONFIG = "SYSTEM_CONFIG";
    public static final String SYSTEM_BACKUP = "SYSTEM_BACKUP";
    public static final String SYSTEM_RESTORE = "SYSTEM_RESTORE";
    public static final String SYSTEM_CLEANUP = "SYSTEM_CLEANUP";
} 