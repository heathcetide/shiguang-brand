
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