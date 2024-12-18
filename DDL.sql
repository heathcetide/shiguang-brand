<<<<<<< HEAD
-- 用户表
CREATE TABLE users (
                       id BIGINT PRIMARY KEY AUTO_INCREMENT,
                       username VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
                       password VARCHAR(255) NOT NULL COMMENT '密码(加密)',
                       email VARCHAR(100) UNIQUE COMMENT '邮箱',
                       phone VARCHAR(20) UNIQUE COMMENT '手机号',
                       nickname VARCHAR(50) COMMENT '昵称',
                       avatar_url VARCHAR(255) COMMENT '头像URL',
                       gender VARCHAR(10) COMMENT '性别',
                       birthday DATE COMMENT '生日',
                       status INT DEFAULT 1 COMMENT '状态(1:正常 2:禁用 3:锁定 4:过期)',
                       role VARCHAR(20) DEFAULT 'USER' COMMENT '角色(USER/ADMIN/SUPER_ADMIN)',
                       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                       updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
                       deleted TINYINT(1) DEFAULT 0 COMMENT '是否删除',
                       INDEX idx_username (username),
                       INDEX idx_email (email),
                       INDEX idx_phone (phone),
                       INDEX idx_status (status),
                       INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';
-- 用户认证扩展表
CREATE TABLE user_authentication (
                                     user_id BIGINT NOT NULL COMMENT '用户ID',
                                     real_name VARCHAR(50) COMMENT '真实姓名',
                                     id_card VARCHAR(18) COMMENT '身份证号',
                                     id_card_urls VARCHAR(255) COMMENT '身份证照片(正反面)',
                                     school VARCHAR(50) COMMENT '学校',
                                     student_urls VARCHAR(255) COMMENT '学生认证图片',
                                     PRIMARY KEY (user_id),
                                     FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户认证扩展表';

-- 用户设置扩展表
CREATE TABLE user_settings (
                               user_id BIGINT NOT NULL COMMENT '用户ID',
                               language VARCHAR(10) DEFAULT 'zh_CN' COMMENT '语言偏好',
                               timezone VARCHAR(50) DEFAULT 'Asia/Shanghai' COMMENT '时区',
                               notification_enabled BOOLEAN DEFAULT TRUE COMMENT '是否启用通知',
                               two_factor_enabled BOOLEAN DEFAULT FALSE COMMENT '是否启用双因素认证',
                               two_factor_secret VARCHAR(100) COMMENT '双因素认证密钥',
                               privacy_settings JSON COMMENT '隐私设置',
                               PRIMARY KEY (user_id),
                               FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户设置扩展表';
-- 社交账号扩展表
CREATE TABLE user_social_accounts (
                                      user_id BIGINT NOT NULL COMMENT '用户ID',
                                      platform VARCHAR(20) NOT NULL COMMENT '社交平台(微信/支付宝等)',
                                      account_id VARCHAR(100) NOT NULL COMMENT '社交账号ID',
                                      UNIQUE KEY (platform, account_id),
                                      FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户社交账号表';


-- 1. 食物基本信息表
CREATE TABLE food_basic (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(50) NOT NULL,
    health_light INT NOT NULL,
    health_label VARCHAR(50),
    suggest VARCHAR(50),
    thumb_image_url VARCHAR(255),
    large_image_url VARCHAR(255),
    is_dynamic_dish TINYINT(1),
    contrast_photo_url VARCHAR(255),
    is_liquid TINYINT(1),
    deleted TINYINT(1) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. 场景表
CREATE TABLE scenes (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    food_id BIGINT NOT NULL,
    scene VARCHAR(50) NOT NULL,
    suitable TINYINT(1),
    tags JSON,
    name VARCHAR(50),
    deleted TINYINT(1) DEFAULT 0,
    FOREIGN KEY (food_id) REFERENCES food_basic (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. 营养信息表
CREATE TABLE Nutrition (
    id SERIAL PRIMARY KEY,
    food_id INT NOT NULL,
    calory FLOAT,
    protein FLOAT,
    fat FLOAT,
    carbohydrate FLOAT,
    fiber_dietary FLOAT,
    natrium FLOAT,
    calcium FLOAT,
    potassium FLOAT,
    iron FLOAT,
    selenium FLOAT,
    FOREIGN KEY (food_id) REFERENCES FoodBasic (id)
);

-- 4. 维生素信息表
CREATE TABLE Vitamins (
    id SERIAL PRIMARY KEY,
    food_id INT NOT NULL,
    vitamin_a FLOAT,
    carotene FLOAT,
    vitamin_d FLOAT,
    vitamin_e FLOAT,
    thiamine FLOAT,
    lactoflavin FLOAT,
    vitamin_c FLOAT,
    niacin FLOAT,
    retinol FLOAT,
    FOREIGN KEY (food_id) REFERENCES FoodBasic (id)
);

-- 5. 矿物质信息表
CREATE TABLE Minerals (
    id SERIAL PRIMARY KEY,
    food_id INT NOT NULL,
    phosphor FLOAT,
    kalium FLOAT,
    magnesium FLOAT,
    calcium FLOAT,
    iron FLOAT,
    zinc FLOAT,
    iodine FLOAT,
    selenium FLOAT,
    copper FLOAT,
    fluorine FLOAT,
    manganese FLOAT,
    FOREIGN KEY (food_id) REFERENCES FoodBasic (id)
);

-- 6. 排名信息表
CREATE TABLE rankings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    food_id BIGINT NOT NULL,
    rank_type VARCHAR(20) NOT NULL,  -- POPULAR(热门), RATING(评分), NUTRITION(营养)
    rank_score DOUBLE NOT NULL,
    rank_position INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted TINYINT(1) DEFAULT 0,
    FOREIGN KEY (food_id) REFERENCES food_basic(id),
    UNIQUE KEY uk_food_type (food_id, rank_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. 血糖指数和负荷表
CREATE TABLE GlycemicIndex (
    id SERIAL PRIMARY KEY,
    food_id INT NOT NULL,
    gi_value FLOAT,
    gi_label VARCHAR(50),
    gl_value FLOAT,
    gl_label VARCHAR(50),
    FOREIGN KEY (food_id) REFERENCES FoodBasic (id)
);

<<<<<<< HEAD
=======
-- 8. 用户表
CREATE TABLE users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
    password VARCHAR(255) NOT NULL COMMENT '密码(加密)',
    email VARCHAR(100) UNIQUE COMMENT '邮箱',
    phone VARCHAR(20) UNIQUE COMMENT '手机号',
    nickname VARCHAR(50) COMMENT '昵称',
    real_name VARCHAR(50) COMMENT '真实姓名',
    id_card VARCHAR(18) COMMENT '身份证号',
    avatar_url VARCHAR(255) COMMENT '头像URL',
    gender VARCHAR(10) COMMENT '性别',
    birthday DATE COMMENT '生日',
    
    -- 账户安全
    account_non_expired BOOLEAN DEFAULT TRUE COMMENT '账号是否未过期',
    account_non_locked BOOLEAN DEFAULT TRUE COMMENT '账号是否未锁定',
    credentials_non_expired BOOLEAN DEFAULT TRUE COMMENT '密码是否未过期',
    enabled BOOLEAN DEFAULT TRUE COMMENT '账号是否启用',
    status INT DEFAULT 1 COMMENT '状态(1:正常 2:禁用 3:锁定 4:过期)',
    last_login_ip VARCHAR(50) COMMENT '最后登录IP',
    last_login_time TIMESTAMP COMMENT '最后登录时间',
    login_attempts INT DEFAULT 0 COMMENT '登录尝试次数',
    password_reset_token VARCHAR(100) COMMENT '密码重置token',
    password_reset_expires TIMESTAMP COMMENT '密码重置token过期时间',
    
    -- 账户验证
    email_verified BOOLEAN DEFAULT FALSE COMMENT '邮箱是否验证',
    phone_verified BOOLEAN DEFAULT FALSE COMMENT '手机是否验证',
    email_verify_token VARCHAR(100) COMMENT '邮箱验证token',
    phone_verify_code VARCHAR(10) COMMENT '手机验证码',
    verify_code_expires TIMESTAMP COMMENT '验证码过期时间',
    
    -- 用户角色和权限
    role VARCHAR(20) DEFAULT 'USER' COMMENT '角色(USER/ADMIN/SUPER_ADMIN)',
    permissions TEXT COMMENT '权限列表(JSON)',
    
    -- 用户设置
    language VARCHAR(10) DEFAULT 'zh_CN' COMMENT '语言偏好',
    timezone VARCHAR(50) DEFAULT 'Asia/Shanghai' COMMENT '时区',
    notification_enabled BOOLEAN DEFAULT TRUE COMMENT '是否启用通知',
    two_factor_enabled BOOLEAN DEFAULT FALSE COMMENT '是否启用双因素认证',
    two_factor_secret VARCHAR(100) COMMENT '双因素认证密钥',
    
    -- 社交账号关联
    wechat_openid VARCHAR(100) COMMENT '微信OpenID',
    wechat_unionid VARCHAR(100) COMMENT '微信UnionID',
    alipay_userid VARCHAR(100) COMMENT '支付宝用户ID',
    
    -- 用户标签和备注
    tags JSON COMMENT '用户标签',
    remarks TEXT COMMENT '备注',
    
    -- 审计字段
    created_by VARCHAR(50) COMMENT '创建人',
    updated_by VARCHAR(50) COMMENT '更新人',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted TINYINT(1) DEFAULT 0 COMMENT '是否删除',
    
    INDEX idx_username (username),
    INDEX idx_email (email),
    INDEX idx_phone (phone),
    INDEX idx_status (status),
    INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

-- 9. 用户饮食记录表
CREATE TABLE UserDietRecords (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    food_id INT NOT NULL,
    portion_size FLOAT NOT NULL,
    meal_time TIMESTAMP NOT NULL,
    meal_type VARCHAR(20), -- 早餐/午餐/晚餐/加餐
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(id),
    FOREIGN KEY (food_id) REFERENCES FoodBasic(id)
);

-- 10. 用户收藏表
CREATE TABLE UserFavorites (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    food_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(id),
    FOREIGN KEY (food_id) REFERENCES FoodBasic(id),
    UNIQUE(user_id, food_id)
);

-- 11. 用户健康数据表
CREATE TABLE UserHealthData (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    height FLOAT,
    weight FLOAT,
    age INT,
    gender VARCHAR(10),
    activity_level INT, -- 1:久坐 2:轻度活动 3:中度活动 4:重度活动
    health_goal VARCHAR(50), -- 减重/增重/维持/营养均衡
    daily_calorie_target INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(id)
);

-- 12. 用户饮食目标表
CREATE TABLE UserDietaryGoals (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    protein_target FLOAT,
    fat_target FLOAT,
    carb_target FLOAT,
    fiber_target FLOAT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(id)
);

-- 13. 用户反馈表
CREATE TABLE UserFeedback (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    food_id INT NOT NULL,
    rating INT CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(id),
    FOREIGN KEY (food_id) REFERENCES FoodBasic(id)
);

-- 食物推荐表
CREATE TABLE food_recommendations (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    food_id BIGINT NOT NULL,
    recommendation_type VARCHAR(20) NOT NULL,  -- HEALTH_GOAL, NUTRITION_BALANCE, PREFERENCE
    recommendation_score DOUBLE NOT NULL,
    reason VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted TINYINT(1) DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (food_id) REFERENCES food_basic(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 用户饮食统计表
CREATE TABLE user_diet_stats (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    stats_date DATE NOT NULL,
    total_calory FLOAT,
    total_protein FLOAT,
    total_fat FLOAT,
    total_carbohydrate FLOAT,
    total_fiber FLOAT,
    breakfast_calory FLOAT,
    lunch_calory FLOAT,
    dinner_calory FLOAT,
    snack_calory FLOAT,
    goal_achievement_rate FLOAT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted TINYINT(1) DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE KEY uk_user_date (user_id, stats_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 用户登录日志表
CREATE TABLE user_login_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL COMMENT '用户ID',
    login_time TIMESTAMP NOT NULL COMMENT '登录时间',
    login_ip VARCHAR(50) COMMENT '登录IP',
    login_location VARCHAR(100) COMMENT '登录地点',
    device_type VARCHAR(50) COMMENT '设备类型',
    os_name VARCHAR(50) COMMENT '操作系统',
    browser VARCHAR(50) COMMENT '浏览器',
    status VARCHAR(20) COMMENT '登录状态(SUCCESS/FAILED)',
    failure_reason VARCHAR(100) COMMENT '失败原因',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户登录日志表';

-- 用户操作日志表
CREATE TABLE user_operation_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL COMMENT '用户ID',
    operation_time TIMESTAMP NOT NULL COMMENT '操作时间',
    operation_type VARCHAR(50) COMMENT '操作类型',
    operation_desc TEXT COMMENT '操作描述',
    operation_method VARCHAR(200) COMMENT '操作方法',
    operation_params TEXT COMMENT '操作参数',
    operation_result TEXT COMMENT '操作结果',
    operation_ip VARCHAR(50) COMMENT '操作IP',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户操作日志表';

-- 用户会话表
CREATE TABLE user_sessions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL COMMENT '用户ID',
    session_token VARCHAR(100) NOT NULL COMMENT '会话token',
    refresh_token VARCHAR(100) COMMENT '刷新token',
    device_id VARCHAR(100) COMMENT '设备ID',
    device_type VARCHAR(50) COMMENT '设备类型',
    ip_address VARCHAR(50) COMMENT 'IP地址',
    user_agent TEXT COMMENT '用户代理',
    expires_at TIMESTAMP COMMENT '过期时间',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户会话表';

CREATE TABLE notifications (
                               id BIGINT AUTO_INCREMENT PRIMARY KEY,
                               user_id BIGINT NOT NULL,
                               type VARCHAR(50),
                               title VARCHAR(255),
                               content TEXT,
                               level VARCHAR(50),
                               read BOOLEAN DEFAULT FALSE,
                               business_id BIGINT,
                               business_type VARCHAR(50),
                               extra_data JSON,
                               send_time DATETIME,
                               read_time DATETIME
);



-- 临时表
CREATE TABLE user (
                      id BIGINT AUTO_INCREMENT PRIMARY KEY,
                      username VARCHAR(255) NOT NULL UNIQUE,
                      password VARCHAR(255) NOT NULL,
                      email VARCHAR(255) UNIQUE,
                      phone VARCHAR(20) UNIQUE,
                      nickname VARCHAR(255),
                      avatar_url VARCHAR(255),
                      status INT DEFAULT 1,
                      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE user_diet_record (
                                  id BIGINT AUTO_INCREMENT PRIMARY KEY,
                                  user_id BIGINT NOT NULL,
                                  meal_time DATETIME NOT NULL,
                                  food_id BIGINT NOT NULL,
                                  portion_size DOUBLE NOT NULL,
                                  meal_type VARCHAR(50),
                                  notes TEXT,
                                  FOREIGN KEY (user_id) REFERENCES user(id),
                                  FOREIGN KEY (food_id) REFERENCES food_basic(id)
);


-- 尚未实现的功能：



用户管理系统
用户注册、登录、注销
密码加密和验证
JWT token认证
用户权限控制
食物管理系统
食物基本信息管理
营养成分管理
维生素管理
矿物质管理
场景管理
血糖指数管理
饮食记录系统
用户饮食记录
饮食目标管理
饮食统计分析
营养分析
安全框架
自定义认证授权
权限控制
角色管理
操作审计
数据脱敏
接口幂等性
数据完整性校验
IP黑名单
登录限制
缓存系统
Redis缓存
Caffeine本地缓存
代码量统计：
1. 实体类(Entity): ~15个，约1500行代码
DTO类: ~12个，约800行代码
3. Service层: ~12个，约2000行代码
Controller层: ~12个，约1500行代码
安全相关: ~30个，约3000行代码
工具类和配置: ~15个，约1000行代码
总计：约9800行代码
前端界面
食物推荐系统
数据可视化
营养建议生成
用户反馈系统
排行榜系统
数据导入导出
系统监控
定时任务
消息通知
完成进度评估：
后端基础架构：90%
核心业务功能：70%
安全框架：85%
数据访问层：80%
缓存系统：75%
整体进度：约75%
建议下一步实现：
1. 完善食物推荐算法
实现营养建议生成
添加数据导入导出功能
实现系统监控
添加消息通知功能
开发前端界面












已完成的核心功能：
用户管理系统
用户注册、登录、注销
JWT认证授权
权限控制
密码加密和验证
食物管理系统
食物基本信息管理
营养成分管理
维生素管理
矿物质管理
场景管理
血糖指数管理
饮食记录系统
用户饮食记录
饮食目标管理
饮食统计分析
营养分析
安全框架
数据脱敏
接口幂等性
数据完整性校验
IP黑名单
登录限制

安全框架
数据脱敏
接口幂等性
数据完整性校验
IP黑名单
登录限制
CSRF防护
XSS防护
SQL注入防护
敏感操作审计
智能推荐系统
食物推荐算法
营养建议生成
用户画像分析
6. 通知系统
邮件通知
站内消息
WebSocket实时推送
数据导入导出
Excel导入导出
数据模板生成


代码量统计：
1. 实体类(Entity): ~20个，约2000行
DTO类: ~15个，约1000行
Mapper接口: ~15个，约600行
XML映射文件: ~15个，约1200行
Service层: ~15个，约2500行
Controller层: ~15个，约1800行
安全相关: ~35个，约3500行
工具类和配置: ~20个，约1500行
总计：约14,100行代码
完成进度评估：
后端基础架构：95%
核心业务功能：85%
安全框架：90%
数据访问层：85%
缓存系统：80%
智能推荐：75%
通知系统：70%
整体进度：约85%
待完成功能：
1. 前端界面开发
2. 系统监控功能
性能监控
资源监控
操作日志
告警通知

定时任务
数据统计
推荐计算
缓存更新
消息队列集成
异步处理
削峰填谷
单元测试
服务层测试
控制器测试
安全测试
下一步建议：
完善系统监控功能
添加定时任务支持
集成消息队列
补充单元测试
开发前端界面
进行性能测试和优化