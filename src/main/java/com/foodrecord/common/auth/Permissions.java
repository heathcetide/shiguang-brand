package com.foodrecord.common.auth;

public class Permissions {
    // 用户管理权限
    public static final String USER_CREATE = "user:create";
    public static final String USER_UPDATE = "user:update";
    public static final String USER_DELETE = "user:delete";
    public static final String USER_VIEW = "user:view";
    
    // 食物管理权限
    public static final String FOOD_CREATE = "food:create";
    public static final String FOOD_UPDATE = "food:update";
    public static final String FOOD_DELETE = "food:delete";
    public static final String FOOD_VIEW = "food:view";
    
    // 营养管理权限
    public static final String NUTRITION_CREATE = "nutrition:create";
    public static final String NUTRITION_UPDATE = "nutrition:update";
    public static final String NUTRITION_DELETE = "nutrition:delete";
    public static final String NUTRITION_VIEW = "nutrition:view";
    
    // 系统管理权限
    public static final String SYSTEM_CONFIG = "system:config";
    public static final String SYSTEM_LOG = "system:log";
    public static final String SYSTEM_BACKUP = "system:backup";
    
    // 数据分析权限
    public static final String DATA_ANALYSIS = "data:analysis";
    public static final String DATA_EXPORT = "data:export";
    public static final String DATA_IMPORT = "data:import";
} 