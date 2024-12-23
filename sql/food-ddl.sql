
-- 1. 食物基本信息表
DROP TABLE IF EXISTS food_basic;

CREATE TABLE food_basic (
                            id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
                            code VARCHAR(50) NOT NULL COMMENT '食物编码',
                            name VARCHAR(50) NOT NULL COMMENT '食物名称',
                            health_light INT NOT NULL COMMENT '健康灯（1=绿灯，2=黄灯，3=红灯）',
                            health_label VARCHAR(50) COMMENT '健康标签',
                            suggest VARCHAR(255) COMMENT '食用建议',
                            thumb_image_url VARCHAR(255) COMMENT '缩略图 URL',
                            large_image_url VARCHAR(255) COMMENT '大图 URL',
                            is_dynamic_dish TINYINT(1) COMMENT '是否为动态菜肴',
                            contrast_photo_url VARCHAR(255) COMMENT '对比图片 URL',
                            is_liquid TINYINT(1) COMMENT '是否为液体（1=是，0=否）',
                            is_available TINYINT(1) DEFAULT 1 COMMENT '是否上架（1=上架，0=下架）',
                            deleted TINYINT(1) DEFAULT 0 COMMENT '逻辑删除标志，0=未删除，1=已删除',
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='食物基本信息表';

-- 创建 v1 表
CREATE TABLE food_basic_v1 (
                               id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
                               code VARCHAR(50) NOT NULL COMMENT '食物编码',
                               name VARCHAR(50) NOT NULL COMMENT '食物名称',
                               health_light INT NOT NULL COMMENT '健康灯（1=绿灯，2=黄灯，3=红灯）',
                               health_label VARCHAR(50) COMMENT '健康标签',
                               suggest VARCHAR(255) COMMENT '食用建议',
                               thumb_image_url VARCHAR(255) COMMENT '缩略图 URL',
                               large_image_url VARCHAR(255) COMMENT '大图 URL',
                               is_dynamic_dish TINYINT(1) COMMENT '是否为动态菜肴',
                               contrast_photo_url VARCHAR(255) COMMENT '对比图片 URL',
                               is_liquid TINYINT(1) COMMENT '是否为液体（1=是，0=否）',
                               is_available TINYINT(1) DEFAULT 1 COMMENT '是否上架（1=上架，0=下架）',
                               deleted TINYINT(1) DEFAULT 0 COMMENT '逻辑删除标志，0=未删除，1=已删除',
                               created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                               updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='食物基本信息表 - 类别 v1';

-- 创建 v2 表
CREATE TABLE food_basic_v2 LIKE food_basic_v1;
ALTER TABLE food_basic_v2 COMMENT '食物基本信息表 - 类别 v2';

-- 创建 v3 表
CREATE TABLE food_basic_v3 LIKE food_basic_v1;
ALTER TABLE food_basic_v3 COMMENT '食物基本信息表 - 类别 v3';



-- 2. 场景表
DROP TABLE IF EXISTS scenes;

CREATE TABLE scenes (
                        id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
                        food_name VARCHAR(250) NOT NULL COMMENT '食物名字（关联食物基本信息表）',
                        scene VARCHAR(50) NOT NULL COMMENT '场景描述',
                        tags JSON COMMENT '场景标签（JSON格式）',
                        name VARCHAR(50) COMMENT '场景名称',
                        deleted TINYINT(1) DEFAULT 0 COMMENT '逻辑删除标志，0=未删除，1=已删除',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='场景表';


DROP TABLE IF EXISTS nutrition;

CREATE TABLE nutrition (
                           id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
                           food_id BIGINT NOT NULL COMMENT '食物 ID',
                           calory FLOAT COMMENT '热量',
                           protein FLOAT COMMENT '蛋白质',
                           fat FLOAT COMMENT '脂肪',
                           carbohydrate FLOAT COMMENT '碳水化合物',
                           fiber_dietary FLOAT COMMENT '膳食纤维',
                           natrium FLOAT COMMENT '钠含量',
                           calcium FLOAT COMMENT '钙含量',
                           potassium FLOAT COMMENT '钾含量',
                           iron FLOAT COMMENT '铁含量',
                           selenium FLOAT COMMENT '硒含量',
                           created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                           updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT '营养信息表';

DROP TABLE IF EXISTS vitamins;

CREATE TABLE vitamins (
                          id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
                          food_id BIGINT NOT NULL COMMENT '食物 ID',
                          vitamin_a FLOAT COMMENT '维生素 A',
                          carotene FLOAT COMMENT '胡萝卜素',
                          vitamin_d FLOAT COMMENT '维生素 D',
                          vitamin_e FLOAT COMMENT '维生素 E',
                          thiamine FLOAT COMMENT '维生素 B1（硫胺素）',
                          lactoflavin FLOAT COMMENT '维生素 B2（核黄素）',
                          vitamin_c FLOAT COMMENT '维生素 C',
                          niacin FLOAT COMMENT '烟酸（维生素 B3）',
                          retinol FLOAT COMMENT '视黄醇',
                          created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT '维生素信息表';

DROP TABLE IF EXISTS minerals;

CREATE TABLE minerals (
                          id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
                          food_id BIGINT NOT NULL COMMENT '食物 ID',
                          phosphor FLOAT COMMENT '磷含量',
                          kalium FLOAT COMMENT '钾含量',
                          magnesium FLOAT COMMENT '镁含量',
                          calcium FLOAT COMMENT '钙含量',
                          iron FLOAT COMMENT '铁含量',
                          zinc FLOAT COMMENT '锌含量',
                          iodine FLOAT COMMENT '碘含量',
                          selenium FLOAT COMMENT '硒含量',
                          copper FLOAT COMMENT '铜含量',
                          fluorine FLOAT COMMENT '氟含量',
                          manganese FLOAT COMMENT '锰含量',
                          created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT '矿物质信息表';

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

DROP TABLE IF EXISTS glycemic_index;

CREATE TABLE glycemic_index (
                                id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
                                food_id BIGINT NOT NULL COMMENT '食物 ID',
                                gi_value FLOAT COMMENT '血糖指数 (GI)',
                                gi_label VARCHAR(50) COMMENT '血糖指数标签',
                                gl_value FLOAT COMMENT '血糖负荷 (GL)',
                                gl_label VARCHAR(50) COMMENT '血糖负荷标签',
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT '血糖指数和负荷表';


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
                                      deleted TINYINT(1) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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


DROP TABLE IF EXISTS user_inventory;

CREATE TABLE user_inventory (
                                id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '库存记录主键',
                                user_id BIGINT NOT NULL COMMENT '用户ID',
                                food_id BIGINT COMMENT '食物ID（关联food_basic表，可为空）',
                                custom_food_name VARCHAR(255) COMMENT '自定义食物名称',
                                quantity FLOAT NOT NULL COMMENT '库存数量（可以是重量、个数等）',
                                unit VARCHAR(50) NOT NULL COMMENT '单位（如克、毫升、个等）',
                                expiration_date DATE COMMENT '保质期()',
                                purchase_date DATE COMMENT '采购日期',
                                last_used_date DATE COMMENT '上次使用日期',
                                source VARCHAR(100) COMMENT '食物来源（如超市、自种、自制等）',
                                usage_category VARCHAR(100) COMMENT '用途分类（如主食、零食、佐料等）',
                                is_available TINYINT(1) DEFAULT 1 COMMENT '是否可用（1=可用，0=不可用）',
                                storage_location VARCHAR(100) COMMENT '存储位置（如冰箱冷藏区、冷冻区、常温储存）',
                                notes VARCHAR(255) COMMENT '备注信息',
                                alert_threshold FLOAT DEFAULT 0 COMMENT '提醒阈值（低于此数量时提醒补货）',
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间',
                                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间',
                                deleted TINYINT(1) DEFAULT 0 COMMENT '逻辑删除标志，0=未删除，1=已删除',
                                FOREIGN KEY (food_id) REFERENCES food_basic(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户库存表（扩展版）';





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