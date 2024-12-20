
-- 1.用户表
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

-- 2.用户认证扩展表
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

-- 3.用户设置扩展表
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
-- 4.社交账号扩展表
CREATE TABLE user_social_accounts (
                                      user_id BIGINT NOT NULL COMMENT '用户ID',
                                      platform VARCHAR(20) NOT NULL COMMENT '社交平台(微信/支付宝等)',
                                      account_id VARCHAR(100) NOT NULL COMMENT '社交账号ID',
                                      UNIQUE KEY (platform, account_id),
                                      FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户社交账号表';

-- 5.用户登录日志表
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

-- 6.用户操作日志表
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

-- 7.用户会话表
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


-- 8.用户等级表
CREATE TABLE user_levels (
                             id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '等级ID',
                             user_id BIGINT NOT NULL COMMENT '用户ID',
                             level_name VARCHAR(50) NOT NULL COMMENT '等级名称',
                             level_points INT DEFAULT 0 COMMENT '等级积分',
                             level_description VARCHAR(255) COMMENT '等级描述',
                             FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户等级表';

-- 9.用户标签表
CREATE TABLE user_tags (
                           user_id BIGINT NOT NULL COMMENT '用户ID',
                           tag VARCHAR(50) NOT NULL COMMENT '标签',
                           PRIMARY KEY (user_id, tag),
                           FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户标签表';

-- 10.用户饮食统计表
CREATE TABLE user_diet_stats (
                                 id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '统计记录ID',
                                 user_id BIGINT NOT NULL COMMENT '用户ID',
                                 stats_date DATE NOT NULL COMMENT '统计日期',
                                 total_calory FLOAT COMMENT '总卡路里',
                                 total_protein FLOAT COMMENT '总蛋白质',
                                 total_fat FLOAT COMMENT '总脂肪',
                                 total_carbohydrate FLOAT COMMENT '总碳水化合物',
                                 total_fiber FLOAT COMMENT '总纤维',
                                 breakfast_calory FLOAT COMMENT '早餐摄入卡路里',
                                 lunch_calory FLOAT COMMENT '午餐摄入卡路里',
                                 dinner_calory FLOAT COMMENT '晚餐摄入卡路里',
                                 snack_calory FLOAT COMMENT '加餐摄入卡路里',
                                 goal_achievement_rate FLOAT COMMENT '目标达成率',
                                 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                                 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
                                 deleted TINYINT(1) DEFAULT 0 COMMENT '是否删除',
                                 FOREIGN KEY (user_id) REFERENCES users(id),
                                 UNIQUE KEY uk_user_date (user_id, stats_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户饮食统计表';

-- 11. 用户饮食记录表
CREATE TABLE user_diet_records (
                                   id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '饮食记录ID',
                                   user_id BIGINT NOT NULL COMMENT '用户ID',
                                   food_id BIGINT NOT NULL COMMENT '食物ID',
                                   portion_size FLOAT NOT NULL COMMENT '份量大小',
                                   meal_time TIMESTAMP NOT NULL COMMENT '用餐时间',
                                   meal_type VARCHAR(20) COMMENT '用餐类型(早餐/午餐/晚餐/加餐)',
                                   notes TEXT COMMENT '备注',
                                   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                                   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
                                   FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户饮食记录表';

-- 12. 用户收藏表
CREATE TABLE user_favorites (
                                id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '收藏记录ID',
                                user_id BIGINT NOT NULL COMMENT '用户ID',
                                food_id BIGINT NOT NULL COMMENT '食物ID',
                                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
                                FOREIGN KEY (user_id) REFERENCES users(id),
                                UNIQUE KEY uk_user_food (user_id, food_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户收藏表';


-- 13. 用户健康数据表
CREATE TABLE user_health_data (
                                  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '健康数据记录ID',
                                  user_id BIGINT NOT NULL COMMENT '用户ID',
                                  height FLOAT COMMENT '身高',
                                  weight FLOAT COMMENT '体重',
                                  age INT COMMENT '年龄',
                                  gender VARCHAR(10) COMMENT '性别',
                                  activity_level INT COMMENT '活动水平(1:久坐 2:轻度活动 3:中度活动 4:重度活动)',
                                  health_goal VARCHAR(50) COMMENT '健康目标(减重/增重/维持/营养均衡)',
                                  daily_calorie_target INT COMMENT '每日卡路里目标',
                                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户健康数据表';

-- 14. 用户饮食目标表
CREATE TABLE user_dietary_goals (
                                    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '饮食目标记录ID',
                                    user_id BIGINT NOT NULL COMMENT '用户ID',
                                    protein_target FLOAT COMMENT '蛋白质目标',
                                    fat_target FLOAT COMMENT '脂肪目标',
                                    carb_target FLOAT COMMENT '碳水目标',
                                    fiber_target FLOAT COMMENT '纤维目标',
                                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户饮食目标表';


-- 15.用户反馈表
CREATE TABLE user_feedback (
                               id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '反馈记录ID',
                               user_id BIGINT NOT NULL COMMENT '用户ID',
                               food_id BIGINT NOT NULL COMMENT '食物ID',
                               rating INT NOT NULL COMMENT '评分（1到5）',
                               comment TEXT COMMENT '用户评价',
                               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                               updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
                               FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户反馈表';