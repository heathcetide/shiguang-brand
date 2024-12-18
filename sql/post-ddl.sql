
-- 帖子表
CREATE TABLE post (
                      id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '帖子ID',
                      user_id BIGINT NOT NULL COMMENT '用户ID',
                      content TEXT COMMENT '内容',
                      media_url VARCHAR(255) COMMENT '媒体URL',
                      tags JSON COMMENT '标签（JSON数组格式）',
                      likes_count INT DEFAULT 0 COMMENT '点赞数',
                      comments_count INT DEFAULT 0 COMMENT '评论数',
                      created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '创建时间',
                      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL COMMENT '更新时间',
                      is_delete TINYINT DEFAULT 0 NOT NULL COMMENT '是否删除（0=否，1=是）'
);

CREATE INDEX idx_post_user_id ON post (user_id);
CREATE INDEX idx_post_created_at ON post (created_at);

-- 点赞表
CREATE TABLE post_likes (
                            id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '点赞ID',
                            post_id BIGINT NOT NULL COMMENT '帖子ID',
                            user_id BIGINT NOT NULL COMMENT '用户ID',
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '创建时间',
                            UNIQUE (post_id, user_id)
);



-- 评论表
CREATE TABLE comment (
                         id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '评论ID',
                         post_id BIGINT NOT NULL COMMENT '帖子ID',
                         user_id BIGINT NOT NULL COMMENT '用户ID',
                         content TEXT NOT NULL COMMENT '评论内容',
                         parent_id BIGINT comment '父评论id',
                         created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '创建时间',
                         updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL COMMENT '修改时间'
);

CREATE INDEX idx_comment_post_id ON comment (post_id);
CREATE INDEX idx_comment_user_id ON comment (user_id);