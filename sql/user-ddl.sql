
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
                       status INT DEFAULT 1 COMMENT '状态(1:正常 2:未填写信息 3:锁定 4:禁用)',
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

DROP TABLE IF EXISTS user_diet_records;
-- 11. 用户饮食记录表
CREATE TABLE user_diet_records (
                                   id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '饮食记录ID',
                                   user_id BIGINT NOT NULL COMMENT '用户ID',
                                   food_id BIGINT NOT NULL COMMENT '食物ID',
                                   portion_size FLOAT NOT NULL COMMENT '份量大小',
                                   meal_time TIMESTAMP NOT NULL COMMENT '用餐时间',
                                   meal_type VARCHAR(20) COMMENT '用餐类型(早餐/午餐/晚餐/加餐)',
                                   dishes JSON COMMENT '菜品信息（JSON格式，包含菜品名称和图片URL）',
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
DROP TABLE IF EXISTS user_health_data;

CREATE TABLE user_health_data (
                                  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '用户信息记录ID',
                                  user_id BIGINT NOT NULL UNIQUE COMMENT '用户ID（唯一标识）',
                                  name VARCHAR(100) NOT NULL COMMENT '用户姓名',
                                  gender TINYINT COMMENT '用户性别',
                                  age INT COMMENT '用户年龄',
                                  height FLOAT NOT NULL COMMENT '用户身高（cm）',
                                  weight FLOAT NOT NULL COMMENT '用户当前体重（kg）',
                                  blood_pressure_high INT COMMENT '高压（收缩压，单位：mmHg）',
                                  blood_pressure_low INT COMMENT '低压（舒张压，单位：mmHg）',
                                  blood_sugar FLOAT COMMENT '血糖水平（单位：mmol/L）',
                                  cholesterol_level FLOAT COMMENT '胆固醇水平（单位：mmol/L）',
                                  heart_rate INT COMMENT '心率（单位：次/分钟）',
                                  bmi FLOAT GENERATED ALWAYS AS (weight / ((height / 100) * (height / 100))) STORED COMMENT 'BMI指数（体重除以身高平方）',
                                  body_fat_percentage FLOAT COMMENT '体脂率（%）',
                                  waist_circumference FLOAT COMMENT '腰围（cm）',
                                  hip_circumference FLOAT COMMENT '臀围（cm）',
                                  whr FLOAT GENERATED ALWAYS AS (waist_circumference / hip_circumference) STORED COMMENT '腰臀比（WHR，腰围/臀围）',
                                  smoking_status ENUM('从不吸烟', '已戒烟', '吸烟') COMMENT '吸烟状态',
                                  alcohol_consumption ENUM('从不饮酒', '偶尔饮酒', '经常饮酒') COMMENT '饮酒状态',
                                  activity_level INT COMMENT '活动水平(1:久坐 2:轻度活动 3:中度活动 4:重度活动)',
                                  sleep_hours_per_day FLOAT COMMENT '平均每日睡眠时间（小时）',
                                  daily_calorie_target INT COMMENT '每日卡路里目标',
                                  deleted TINYINT(1) DEFAULT 0 COMMENT '是否删除',
                                  last_updated_date DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '数据最后更新时间（精确到天）',
                                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（精确到天）'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户详细健康信息表';


-- 14. 用户饮食目标表
DROP TABLE IF EXISTS user_dietary_goals;

CREATE TABLE user_dietary_goals (
                                    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '目标记录ID',
                                    user_id BIGINT NOT NULL COMMENT '用户ID',
                                    goal_category ENUM('减重', '减脂', '增重', '降血压', '升血压', '健康维持', '其他') NOT NULL COMMENT '目标分类',
                                    target_weight FLOAT COMMENT '目标体重（kg）',
                                    target_blood_pressure_high INT COMMENT '目标高压（收缩压，单位：mmHg）',
                                    target_blood_pressure_low INT COMMENT '目标低压（舒张压，单位：mmHg）',
                                    target_blood_sugar FLOAT COMMENT '目标血糖水平（单位：mmol/L）',
                                    target_body_fat FLOAT COMMENT '目标体脂率（%）',
                                    target_protein FLOAT COMMENT '目标蛋白质摄入（g）',
                                    target_fat FLOAT COMMENT '目标脂肪摄入（g）',
                                    target_carb FLOAT COMMENT '目标碳水摄入（g）',
                                    target_fiber FLOAT COMMENT '目标纤维摄入（g）',
                                    notes TEXT COMMENT '备注信息（目标说明或医生建议）',
                                    start_date DATE NOT NULL COMMENT '目标开始日期',
                                    end_date DATE COMMENT '目标结束日期',
                                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户目标管理表';


DROP TABLE IF EXISTS user_health_plan;

CREATE TABLE user_health_plan (
                                  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '计划记录ID',
                                  user_id BIGINT NOT NULL COMMENT '用户ID',
                                  goal_id BIGINT NOT NULL COMMENT '饮食目标ID（关联user_dietary_goals表）',
                                  plan_date DATE NOT NULL COMMENT '计划日期（2005-10-22格式）',
                                  plan_category VARCHAR(50) NOT NULL COMMENT '计划类型（饮食、运动等）',
                                  plan_content TEXT NOT NULL COMMENT '计划内容（具体计划描述）',
                                  meals JSON DEFAULT NULL COMMENT '每日食谱，JSON格式存储',
                                  exercises JSON DEFAULT NULL COMMENT '每日运动计划，JSON格式存储',
                                  status ENUM('未开始', '进行中', '已结束') DEFAULT '未开始' COMMENT '计划状态',
                                  progress FLOAT DEFAULT 0 COMMENT '今日计划完成进度百分比（0-100）',
                                  today_exercise_target FLOAT COMMENT '今日运动目标（单位：分钟或其他）',
                                  today_exercise_completed FLOAT DEFAULT 0 COMMENT '今日实际完成运动量',
                                  today_calorie_target FLOAT COMMENT '今日目标卡路里摄入量',
                                  today_calorie_completed FLOAT DEFAULT 0 COMMENT '今日实际摄入的卡路里',
                                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户每日健康计划表';


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


-- 好友表
CREATE TABLE friendships (
                             id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '表主键',
                             user_id BIGINT NOT NULL COMMENT '用户ID',
                             friend_id BIGINT NOT NULL COMMENT '好友ID',
                             status TINYINT DEFAULT 0 NOT NULL COMMENT '0等待确认，1已添加',
                             created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '创建时间',
                             UNIQUE (user_id, friend_id)
);

-- 热点与话题表
CREATE TABLE topics (
                        id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '话题表ID',
                        name VARCHAR(100) NOT NULL UNIQUE COMMENT '话题名',
                        popularity INT DEFAULT 0 NOT NULL COMMENT '热度值',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '创建时间'
);