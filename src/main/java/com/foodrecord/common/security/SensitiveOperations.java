package com.foodrecord.common.security;

public class SensitiveOperations {
    // 账户安全相关
    public static final String PASSWORD_CHANGE = "PASSWORD_CHANGE";
    public static final String EMAIL_CHANGE = "EMAIL_CHANGE";
    public static final String PHONE_CHANGE = "PHONE_CHANGE";
    public static final String TWO_FACTOR_ENABLE = "TWO_FACTOR_ENABLE";
    public static final String TWO_FACTOR_DISABLE = "TWO_FACTOR_DISABLE";
    
    // 权限相关
    public static final String ROLE_CHANGE = "ROLE_CHANGE";
    public static final String PERMISSION_GRANT = "PERMISSION_GRANT";
    public static final String PERMISSION_REVOKE = "PERMISSION_REVOKE";
    
    // 账户状态相关
    public static final String ACCOUNT_LOCK = "ACCOUNT_LOCK";
    public static final String ACCOUNT_UNLOCK = "ACCOUNT_UNLOCK";
    public static final String ACCOUNT_DISABLE = "ACCOUNT_DISABLE";
    public static final String ACCOUNT_ENABLE = "ACCOUNT_ENABLE";
    
    // 敏感数据相关
    public static final String DATA_EXPORT = "DATA_EXPORT";
    public static final String DATA_DELETE = "DATA_DELETE";
    public static final String DATA_MODIFY = "DATA_MODIFY";
    
    // 系统配置相关
    public static final String SYSTEM_CONFIG_CHANGE = "SYSTEM_CONFIG_CHANGE";
    public static final String SECURITY_POLICY_CHANGE = "SECURITY_POLICY_CHANGE";
} 