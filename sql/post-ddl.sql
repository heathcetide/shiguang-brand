
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

create table cool_comment_db.video_comments
(
    id         bigint auto_increment comment '评论ID'
        primary key,
    video_id   bigint                             not null comment '视频ID',
    user_id    bigint                             not null comment '用户ID',
    content    text                               not null comment '评论内容',
    parent_id  bigint                             null comment '父评论ID（用于回复）',
    created_at datetime default CURRENT_TIMESTAMP not null comment '创建时间',
    updated_at datetime default CURRENT_TIMESTAMP not null on update CURRENT_TIMESTAMP comment '更新时间'
)
    comment '视频评论表';

create index idx_video_comments_user_id
    on cool_comment_db.video_comments (user_id);

create index idx_video_comments_video_id
    on cool_comment_db.video_comments (video_id);

create table cool_comment_db.video_favorites
(
    id         bigint auto_increment comment '收藏ID'
        primary key,
    user_id    bigint                             not null comment '用户ID',
    video_id   bigint                             not null comment '视频ID',
    created_at datetime default CURRENT_TIMESTAMP not null comment '创建时间',
    constraint user_id
        unique (user_id, video_id)
)
    comment '视频收藏表';

create index idx_video_favorites_user_id
    on cool_comment_db.video_favorites (user_id);

create index idx_video_favorites_video_id
    on cool_comment_db.video_favorites (video_id);

create table cool_comment_db.video_likes
(
    id         bigint auto_increment comment '点赞ID'
        primary key,
    video_id   bigint                             not null comment '视频ID',
    user_id    bigint                             not null comment '用户ID',
    created_at datetime default CURRENT_TIMESTAMP not null comment '创建时间',
    constraint video_id
        unique (video_id, user_id)
)
    comment '视频点赞表';

create index idx_video_likes_user_id
    on cool_comment_db.video_likes (user_id);

create index idx_video_likes_video_id
    on cool_comment_db.video_likes (video_id);

create table cool_comment_db.video_tags
(
    id         bigint auto_increment comment '标签ID'
        primary key,
    video_id   bigint                             not null comment '视频ID',
    tag        varchar(50)                        not null comment '标签内容',
    created_at datetime default CURRENT_TIMESTAMP not null comment '创建时间'
)
    comment '视频标签表';

create index idx_video_tags_tag
    on cool_comment_db.video_tags (tag);

create index idx_video_tags_video_id
    on cool_comment_db.video_tags (video_id);

create table cool_comment_db.videos
(
    id             bigint auto_increment comment '视频ID'
        primary key,
    user_id        bigint                             not null comment '用户ID，发布者',
    title          varchar(255)                       not null comment '视频标题',
    description    text                               null comment '视频描述',
    video_url      varchar(255)                       not null comment '视频存储的URL',
    thumbnail_url  varchar(255)                       null comment '视频封面图URL',
    duration       int                                not null comment '视频时长（秒）',
    views_count    int      default 0                 null comment '观看次数',
    likes_count    int      default 0                 null comment '点赞次数',
    comments_count int      default 0                 null comment '评论次数',
    created_at     datetime default CURRENT_TIMESTAMP not null comment '创建时间',
    updated_at     datetime default CURRENT_TIMESTAMP not null on update CURRENT_TIMESTAMP comment '更新时间',
    is_delete      tinyint  default 0                 not null comment '是否删除（0=否，1=是）'
)
    comment '短视频表';

create table cool_comment_db.watch_history
(
    id         bigint auto_increment comment '历史记录ID'
        primary key,
    user_id    bigint                             not null comment '用户ID',
    video_id   bigint                             not null comment '视频ID',
    watched_at datetime default CURRENT_TIMESTAMP not null comment '观看时间'
)
    comment '用户观看历史表';

create index idx_watch_history_user_id
    on cool_comment_db.watch_history (user_id);

create index idx_watch_history_video_id
    on cool_comment_db.watch_history (video_id);

