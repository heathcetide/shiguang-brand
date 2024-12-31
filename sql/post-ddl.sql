
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


-- 视频转码任务表
CREATE TABLE `video_transcode_tasks` (
                                         `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                         `video_id` bigint(20) NOT NULL COMMENT '视频ID',
                                         `source_url` varchar(255) NOT NULL COMMENT '源视频URL',
                                         `target_url` varchar(255) DEFAULT NULL COMMENT '转码后视频URL',
                                         `format` varchar(20) NOT NULL COMMENT '目标格式',
                                         `resolution` varchar(20) NOT NULL COMMENT '目标分辨率',
                                         `status` tinyint(4) NOT NULL DEFAULT '0' COMMENT '状态：0=待处理，1=处理中，2=已完成，3=失败',
                                         `progress` int(11) DEFAULT '0' COMMENT '转码进度(0-100)',
                                         `error_msg` varchar(500) DEFAULT NULL COMMENT '错误信息',
                                         `created_at` datetime NOT NULL COMMENT '创建时间',
                                         `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                         PRIMARY KEY (`id`),
                                         KEY `idx_video_id` (`video_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频转码任务表';

-- 视频审核记录表
CREATE TABLE `video_audit_records` (
                                       `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                       `video_id` bigint(20) NOT NULL COMMENT '视频ID',
                                       `auditor_id` bigint(20) DEFAULT NULL COMMENT '审核人ID',
                                       `status` tinyint(4) NOT NULL DEFAULT '0' COMMENT '状态：0=待审核，1=审核通过，2=审核不通过',
                                       `reason` varchar(500) DEFAULT NULL COMMENT '审核意见',
                                       `created_at` datetime NOT NULL COMMENT '创建时间',
                                       `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                       PRIMARY KEY (`id`),
                                       KEY `idx_video_id` (`video_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频审核记录表';

-- 视频统计表
CREATE TABLE `video_statistics` (
                                    `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                    `video_id` bigint(20) NOT NULL COMMENT '视频ID',
                                    `views_count` int(11) DEFAULT '0' COMMENT '播放次数',
                                    `likes_count` int(11) DEFAULT '0' COMMENT '点赞次数',
                                    `shares_count` int(11) DEFAULT '0' COMMENT '分享次数',
                                    `comments_count` int(11) DEFAULT '0' COMMENT '评论次数',
                                    `avg_watch_time` int(11) DEFAULT '0' COMMENT '平均观看时长(秒)',
                                    `created_at` datetime NOT NULL COMMENT '创建时间',
                                    `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                    PRIMARY KEY (`id`),
                                    UNIQUE KEY `uk_video_id` (`video_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频统计表';

-- 视频观看历史表
CREATE TABLE `video_watch_history` (
                                       `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                       `user_id` bigint(20) NOT NULL COMMENT '用户ID',
                                       `video_id` bigint(20) NOT NULL COMMENT '视频ID',
                                       `watch_duration` int(11) NOT NULL DEFAULT '0' COMMENT '观看时长(秒)',
                                       `watch_progress` float NOT NULL DEFAULT '0' COMMENT '观看进度(0-1)',
                                       `created_at` datetime NOT NULL COMMENT '创建时间',
                                       `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                       PRIMARY KEY (`id`),
                                       KEY `idx_user_video` (`user_id`,`video_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频观看历史表';

-- 视频弹幕表
CREATE TABLE `video_danmaku` (
                                 `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                 `video_id` bigint(20) NOT NULL COMMENT '视频ID',
                                 `user_id` bigint(20) NOT NULL COMMENT '用户ID',
                                 `content` varchar(500) NOT NULL COMMENT '弹幕内容',
                                 `timestamp` int(11) NOT NULL COMMENT '弹幕时间点(秒)',
                                 `color` varchar(10) DEFAULT '#ffffff' COMMENT '弹幕颜色',
                                 `position` varchar(10) DEFAULT 'scroll' COMMENT '弹幕位置(scroll/top/bottom)',
                                 `created_at` datetime NOT NULL COMMENT '创建时间',
                                 PRIMARY KEY (`id`),
                                 KEY `idx_video_time` (`video_id`,`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频弹幕表';

-- 视频质量版本表
CREATE TABLE `video_quality_versions` (
                                          `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                          `video_id` bigint(20) NOT NULL COMMENT '视频ID',
                                          `quality` varchar(20) NOT NULL COMMENT '清晰度(1080p/720p/480p/360p)',
                                          `video_url` varchar(255) NOT NULL COMMENT '视频URL',
                                          `file_size` bigint(20) NOT NULL COMMENT '文件大小(字节)',
                                          `bitrate` int(11) NOT NULL COMMENT '比特率(kbps)',
                                          `created_at` datetime NOT NULL COMMENT '创建时间',
                                          PRIMARY KEY (`id`),
                                          UNIQUE KEY `uk_video_quality` (`video_id`,`quality`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频质量版本表';

-- 视频水印配置表
CREATE TABLE `video_watermarks` (
                                    `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                    `video_id` bigint(20) NOT NULL COMMENT '视频ID',
                                    `watermark_type` varchar(20) NOT NULL COMMENT '水印类型(text/image)',
                                    `content` varchar(500) NOT NULL COMMENT '水印内容(文字或图片URL)',
                                    `position` varchar(20) NOT NULL COMMENT '位置(topLeft/topRight/bottomLeft/bottomRight/center)',
                                    `opacity` float NOT NULL DEFAULT '1.0' COMMENT '透明度(0-1)',
                                    `size` int(11) NOT NULL DEFAULT '24' COMMENT '大小(文字大小或图片宽度)',
                                    `created_at` datetime NOT NULL COMMENT '创建时间',
                                    `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                    PRIMARY KEY (`id`),
                                    KEY `idx_video_id` (`video_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频水印配置表';

-- 视频分享记录表
CREATE TABLE `video_shares` (
                                `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                `video_id` bigint(20) NOT NULL COMMENT '视频ID',
                                `user_id` bigint(20) NOT NULL COMMENT '分享用户ID',
                                `platform` varchar(50) NOT NULL COMMENT '分享平台(wechat/weibo/qq等)',
                                `share_url` varchar(255) NOT NULL COMMENT '分享链接',
                                `share_count` int(11) NOT NULL DEFAULT '0' COMMENT '分享次数',
                                `created_at` datetime NOT NULL COMMENT '创建时间',
                                `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                PRIMARY KEY (`id`),
                                KEY `idx_video_user` (`video_id`,`user_id`),
                                KEY `idx_platform` (`platform`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频分享记录表';


-- 视频下载记录表
CREATE TABLE `video_downloads` (
                                   `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                   `video_id` bigint(20) NOT NULL COMMENT '视频ID',
                                   `user_id` bigint(20) NOT NULL COMMENT '下载用户ID',
                                   `quality` varchar(20) DEFAULT NULL COMMENT '下载质量(1080p/720p等)',
                                   `download_url` varchar(255) NOT NULL COMMENT '下载链接',
                                   `status` tinyint(4) NOT NULL DEFAULT '0' COMMENT '状态：0=待下载，1=下载中，2=已完成，3=失败',
                                   `progress` int(11) DEFAULT '0' COMMENT '下载进度(0-100)',
                                   `file_size` bigint(20) DEFAULT NULL COMMENT '文件大小(字节)',
                                   `created_at` datetime NOT NULL COMMENT '创建时间',
                                   `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                   PRIMARY KEY (`id`),
                                   KEY `idx_video_user` (`video_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频下载记录表';

-- 视频直播表
CREATE TABLE `video_live_streams` (
                                      `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                      `user_id` bigint(20) NOT NULL COMMENT '主播用户ID',
                                      `title` varchar(100) NOT NULL COMMENT '直播标题',
                                      `description` text COMMENT '直播描述',
                                      `cover_url` varchar(255) DEFAULT NULL COMMENT '封面图URL',
                                      `stream_key` varchar(50) NOT NULL COMMENT '推流密钥',
                                      `rtmp_url` varchar(255) NOT NULL COMMENT 'RTMP推流地址',
                                      `hls_url` varchar(255) NOT NULL COMMENT 'HLS播放地址',
                                      `status` tinyint(4) NOT NULL DEFAULT '0' COMMENT '状态：0=未开始，1=直播中，2=已结束',
                                      `start_time` datetime DEFAULT NULL COMMENT '开始时间',
                                      `end_time` datetime DEFAULT NULL COMMENT '结束时间',
                                      `viewers_count` int(11) DEFAULT '0' COMMENT '观看人数',
                                      `likes_count` int(11) DEFAULT '0' COMMENT '点赞数',
                                      `created_at` datetime NOT NULL COMMENT '创建时间',
                                      `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                      PRIMARY KEY (`id`),
                                      KEY `idx_user_status` (`user_id`,`status`),
                                      KEY `idx_stream_key` (`stream_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频直播表';

-- 直播观看记录表
CREATE TABLE `live_stream_viewers` (
                                       `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                       `stream_id` bigint(20) NOT NULL COMMENT '直播ID',
                                       `user_id` bigint(20) NOT NULL COMMENT '观看用户ID',
                                       `join_time` datetime NOT NULL COMMENT '加入时间',
                                       `leave_time` datetime DEFAULT NULL COMMENT '离开时间',
                                       `duration` int(11) DEFAULT '0' COMMENT '观看时长(秒)',
                                       `created_at` datetime NOT NULL COMMENT '创建时间',
                                       PRIMARY KEY (`id`),
                                       KEY `idx_stream_user` (`stream_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='直播观看记录表';




###############

-- 视频水印配置表
CREATE TABLE `video_watermarks` (
                                    `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                    `video_id` bigint(20) NOT NULL COMMENT '视频ID',
                                    `watermark_type` varchar(20) NOT NULL COMMENT '水印类型(text/image)',
                                    `content` varchar(500) NOT NULL COMMENT '水印内容(文字或图片URL)',
                                    `position` varchar(20) NOT NULL COMMENT '位置(topLeft/topRight/bottomLeft/bottomRight/center)',
                                    `opacity` float NOT NULL DEFAULT '1.0' COMMENT '透明度(0-1)',
                                    `size` int(11) NOT NULL DEFAULT '24' COMMENT '大小(文字大小或图片宽度)',
                                    `created_at` datetime NOT NULL COMMENT '创建时间',
                                    `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                    PRIMARY KEY (`id`),
                                    KEY `idx_video_id` (`video_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频水印配置表';

-- 视频分享记录表
CREATE TABLE `video_shares` (
                                `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                `video_id` bigint(20) NOT NULL COMMENT '视频ID',
                                `user_id` bigint(20) NOT NULL COMMENT '分享用户ID',
                                `platform` varchar(50) NOT NULL COMMENT '分享平台(wechat/weibo/qq等)',
                                `share_url` varchar(255) NOT NULL COMMENT '分享链接',
                                `share_count` int(11) NOT NULL DEFAULT '0' COMMENT '分享次数',
                                `created_at` datetime NOT NULL COMMENT '创建时间',
                                `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                PRIMARY KEY (`id`),
                                KEY `idx_video_user` (`video_id`,`user_id`),
                                KEY `idx_platform` (`platform`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频分享记录表';

-- 视频下载记录表
CREATE TABLE `video_downloads` (
                                   `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                   `video_id` bigint(20) NOT NULL COMMENT '视频ID',
                                   `user_id` bigint(20) NOT NULL COMMENT '下载用户ID',
                                   `quality` varchar(20) DEFAULT NULL COMMENT '下载质量(1080p/720p等)',
                                   `download_url` varchar(255) NOT NULL COMMENT '下载链接',
                                   `status` tinyint(4) NOT NULL DEFAULT '0' COMMENT '状态：0=待下载，1=下载中，2=已完成，3=失败',
                                   `progress` int(11) DEFAULT '0' COMMENT '下载进度(0-100)',
                                   `file_size` bigint(20) DEFAULT NULL COMMENT '文件大小(字节)',
                                   `created_at` datetime NOT NULL COMMENT '创建时间',
                                   `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                   PRIMARY KEY (`id`),
                                   KEY `idx_video_user` (`video_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频下载记录表';

-- 视频直播表
CREATE TABLE `video_live_streams` (
                                      `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                      `user_id` bigint(20) NOT NULL COMMENT '主播用户ID',
                                      `title` varchar(100) NOT NULL COMMENT '直播标题',
                                      `description` text COMMENT '直播描述',
                                      `cover_url` varchar(255) DEFAULT NULL COMMENT '封面图URL',
                                      `stream_key` varchar(50) NOT NULL COMMENT '推流密钥',
                                      `rtmp_url` varchar(255) NOT NULL COMMENT 'RTMP推流地址',
                                      `hls_url` varchar(255) NOT NULL COMMENT 'HLS播放地址',
                                      `status` tinyint(4) NOT NULL DEFAULT '0' COMMENT '状态：0=未开始，1=直播中，2=已结束',
                                      `start_time` datetime DEFAULT NULL COMMENT '开始时间',
                                      `end_time` datetime DEFAULT NULL COMMENT '结束时间',
                                      `viewers_count` int(11) DEFAULT '0' COMMENT '观看人数',
                                      `likes_count` int(11) DEFAULT '0' COMMENT '点赞数',
                                      `created_at` datetime NOT NULL COMMENT '创建时间',
                                      `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                      PRIMARY KEY (`id`),
                                      KEY `idx_user_status` (`user_id`,`status`),
                                      KEY `idx_stream_key` (`stream_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频直播表';

-- 直播观看记录表
CREATE TABLE `live_stream_viewers` (
                                       `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                       `stream_id` bigint(20) NOT NULL COMMENT '直播ID',
                                       `user_id` bigint(20) NOT NULL COMMENT '观看用户ID',
                                       `join_time` datetime NOT NULL COMMENT '加入时间',
                                       `leave_time` datetime DEFAULT NULL COMMENT '离开时间',
                                       `duration` int(11) DEFAULT '0' COMMENT '观看时长(秒)',
                                       `created_at` datetime NOT NULL COMMENT '创建时间',
                                       PRIMARY KEY (`id`),
                                       KEY `idx_stream_user` (`stream_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='直播观看记录表';

-- 视频下载记录表
CREATE TABLE `video_downloads` (
                                   `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                   `video_id` bigint(20) NOT NULL COMMENT '视频ID',
                                   `user_id` bigint(20) NOT NULL COMMENT '下载用户ID',
                                   `quality` varchar(20) DEFAULT NULL COMMENT '下载质量(1080p/720p等)',
                                   `download_url` varchar(255) NOT NULL COMMENT '下载链接',
                                   `status` tinyint(4) NOT NULL DEFAULT '0' COMMENT '状态：0=待下载，1=下载中，2=已完成，3=失败',
                                   `progress` int(11) DEFAULT '0' COMMENT '下载进度(0-100)',
                                   `file_size` bigint(20) DEFAULT NULL COMMENT '文件大小(字节)',
                                   `created_at` datetime NOT NULL COMMENT '创建时间',
                                   `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                   PRIMARY KEY (`id`),
                                   KEY `idx_video_user` (`video_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频下载记录表';

-- 视频直播表
CREATE TABLE `video_live_streams` (
                                      `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                      `user_id` bigint(20) NOT NULL COMMENT '主播用户ID',
                                      `title` varchar(100) NOT NULL COMMENT '直播标题',
                                      `description` text COMMENT '直播描述',
                                      `cover_url` varchar(255) DEFAULT NULL COMMENT '封面图URL',
                                      `stream_key` varchar(50) NOT NULL COMMENT '推流密钥',
                                      `rtmp_url` varchar(255) NOT NULL COMMENT 'RTMP推流地址',
                                      `hls_url` varchar(255) NOT NULL COMMENT 'HLS播放地址',
                                      `status` tinyint(4) NOT NULL DEFAULT '0' COMMENT '状态：0=未开始，1=直播中，2=已结束',
                                      `start_time` datetime DEFAULT NULL COMMENT '开始时间',
                                      `end_time` datetime DEFAULT NULL COMMENT '结束时间',
                                      `viewers_count` int(11) DEFAULT '0' COMMENT '观看人数',
                                      `likes_count` int(11) DEFAULT '0' COMMENT '点赞数',
                                      `created_at` datetime NOT NULL COMMENT '创建时间',
                                      `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                      PRIMARY KEY (`id`),
                                      KEY `idx_user_status` (`user_id`,`status`),
                                      KEY `idx_stream_key` (`stream_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频直播表';

-- 直播观看记录表
CREATE TABLE `live_stream_viewers` (
                                       `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                       `stream_id` bigint(20) NOT NULL COMMENT '直播ID',
                                       `user_id` bigint(20) NOT NULL COMMENT '观看用户ID',
                                       `join_time` datetime NOT NULL COMMENT '加入时间',
                                       `leave_time` datetime DEFAULT NULL COMMENT '离开时间',
                                       `duration` int(11) DEFAULT '0' COMMENT '观看时长(秒)',
                                       `created_at` datetime NOT NULL COMMENT '创建时间',
                                       PRIMARY KEY (`id`),
                                       KEY `idx_stream_user` (`stream_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='直播观看记录表';


-- 视频背景音乐表
CREATE TABLE `video_background_music` (
                                          `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                          `title` varchar(100) NOT NULL COMMENT '音乐标题',
                                          `artist` varchar(100) DEFAULT NULL COMMENT '艺术家',
                                          `duration` int(11) NOT NULL COMMENT '时长(秒)',
                                          `music_url` varchar(255) NOT NULL COMMENT '音乐文件URL',
                                          `cover_url` varchar(255) DEFAULT NULL COMMENT '封面图URL',
                                          `category` varchar(50) DEFAULT NULL COMMENT '分类',
                                          `use_count` int(11) DEFAULT '0' COMMENT '使用次数',
                                          `status` tinyint(4) NOT NULL DEFAULT '1' COMMENT '状态：0=禁用，1=启用',
                                          `created_at` datetime NOT NULL COMMENT '创建时间',
                                          `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                          PRIMARY KEY (`id`),
                                          KEY `idx_category` (`category`),
                                          KEY `idx_use_count` (`use_count`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频背景音乐表';

-- 视频编辑记录表
CREATE TABLE `video_edit_records` (
                                      `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                      `video_id` bigint(20) NOT NULL COMMENT '视频ID',
                                      `user_id` bigint(20) NOT NULL COMMENT '编辑用户ID',
                                      `edit_type` varchar(50) NOT NULL COMMENT '编辑类型(trim/merge/filter/text等)',
                                      `edit_params` text COMMENT '编辑参数(JSON格式)',
                                      `source_url` varchar(255) NOT NULL COMMENT '源视频URL',
                                      `target_url` varchar(255) DEFAULT NULL COMMENT '编辑后视频URL',
                                      `status` tinyint(4) NOT NULL DEFAULT '0' COMMENT '状态：0=处理中，1=成功，2=失败',
                                      `error_msg` varchar(500) DEFAULT NULL COMMENT '错误信息',
                                      `created_at` datetime NOT NULL COMMENT '创建时间',
                                      `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                      PRIMARY KEY (`id`),
                                      KEY `idx_video_user` (`video_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频编辑记录表';

-- 视频特效配置表
CREATE TABLE `video_effects` (
                                 `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                 `video_id` bigint(20) NOT NULL COMMENT '视频ID',
                                 `effect_type` varchar(50) NOT NULL COMMENT '特效类型',
                                 `effect_params` text NOT NULL COMMENT '特效参数(JSON格式)',
                                 `start_time` int(11) NOT NULL COMMENT '开始时间(秒)',
                                 `duration` int(11) NOT NULL COMMENT '持续时长(秒)',
                                 `created_at` datetime NOT NULL COMMENT '创建时间',
                                 `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                 PRIMARY KEY (`id`),
                                 KEY `idx_video_id` (`video_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频特效配置表';

-- 视频字幕表
CREATE TABLE `video_subtitles` (
                                   `id` bigint(20) NOT NULL AUTO_INCREMENT,
                                   `video_id` bigint(20) NOT NULL COMMENT '视频ID',
                                   `language` varchar(10) NOT NULL COMMENT '语言代码',
                                   `content` text NOT NULL COMMENT '字幕内容(SRT格式)',
                                   `is_auto` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否自动生成',
                                   `status` tinyint(4) NOT NULL DEFAULT '1' COMMENT '状态：0=禁用，1=启用',
                                   `created_at` datetime NOT NULL COMMENT '创建时间',
                                   `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
                                   PRIMARY KEY (`id`),
                                   UNIQUE KEY `uk_video_lang` (`video_id`,`language`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频字幕表';


-- 创建帖子收藏表
CREATE TABLE IF NOT EXISTS `post_favorites` (
                                                `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
                                                `post_id` BIGINT NOT NULL COMMENT '帖子ID',
                                                `user_id` BIGINT NOT NULL COMMENT '用户ID',
                                                `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                                                `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
                                                `is_delete` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除：0-未删除，1-已删除',
                                                PRIMARY KEY (`id`),
                                                UNIQUE KEY `uk_post_user` (`post_id`, `user_id`, `is_delete`),
                                                KEY `idx_user_id` (`user_id`),
                                                KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='帖子收藏表';

-- 创建帖子举报表
CREATE TABLE IF NOT EXISTS `post_report` (
                                             `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
                                             `post_id` BIGINT NOT NULL COMMENT '帖子ID',
                                             `user_id` BIGINT NOT NULL COMMENT '举报用户ID',
                                             `reason` VARCHAR(500) NOT NULL COMMENT '举报原因',
                                             `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT '处理状态：PENDING-待处理，APPROVED-已批准，REJECTED-已拒绝',
                                             `feedback` VARCHAR(500) DEFAULT NULL COMMENT '处理反馈',
                                             `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                                             `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
                                             `is_delete` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除：0-未删除，1-已删除',
                                             PRIMARY KEY (`id`),
                                             UNIQUE KEY `uk_post_user` (`post_id`, `user_id`, `is_delete`),
                                             KEY `idx_user_id` (`user_id`),
                                             KEY `idx_status` (`status`),
                                             KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='帖子举报表';

-- 修改帖子表，添加置顶字段
ALTER TABLE `post`
    ADD COLUMN `is_pinned` TINYINT NOT NULL DEFAULT 0 COMMENT '是否置顶：0-未置顶，1-已置顶' AFTER `is_delete`,
    ADD INDEX `idx_is_pinned` (`is_pinned`);

-- 添加外键约束（如果需要的话，取消注释以下语句）
-- ALTER TABLE `post_favorites`
-- ADD CONSTRAINT `fk_favorites_post` FOREIGN KEY (`post_id`) REFERENCES `post` (`id`),
-- ADD CONSTRAINT `fk_favorites_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`);

-- ALTER TABLE `post_report`
-- ADD CONSTRAINT `fk_report_post` FOREIGN KEY (`post_id`) REFERENCES `post` (`id`),
-- ADD CONSTRAINT `fk_report_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`);



-- 为comment表添加管理相关字段
ALTER TABLE comment
    -- 评论状态: approved(已通过), rejected(已拒绝), pending(待审核)
    ADD COLUMN status VARCHAR(20) DEFAULT 'pending' NOT NULL COMMENT '评论状态',

    -- 评论是否可见
    ADD COLUMN is_visible BOOLEAN DEFAULT TRUE NOT NULL COMMENT '评论是否可见',

    -- 是否是精选评论
    ADD COLUMN is_highlight BOOLEAN DEFAULT FALSE NOT NULL COMMENT '是否是精选评论',

    -- 警告相关字段
    ADD COLUMN warning_message TEXT COMMENT '警告消息',
    ADD COLUMN warning_time DATETIME COMMENT '警告时间',

    -- 情感倾向: positive(积极), negative(消极), neutral(中性)
    ADD COLUMN sentiment VARCHAR(20) DEFAULT 'neutral' COMMENT '情感倾向',

    -- 拒绝原因
    ADD COLUMN reject_reason TEXT COMMENT '拒绝原因',

    -- 审核时间
    ADD COLUMN audit_time DATETIME COMMENT '审核时间',

    -- 审核人ID
    ADD COLUMN auditor_id BIGINT COMMENT '审核人ID',

    -- 敏感词命中数
    ADD COLUMN sensitive_word_count INT DEFAULT 0 NOT NULL COMMENT '敏感词命中数',

    -- 质量分数
    ADD COLUMN quality_score DECIMAL(5,2) DEFAULT 0.00 COMMENT '质量分数';

-- 添加索引
CREATE INDEX idx_comment_status ON comment(status);
CREATE INDEX idx_comment_created_at ON comment(created_at);
CREATE INDEX idx_comment_user_id ON comment(user_id);
CREATE INDEX idx_comment_is_highlight ON comment(is_highlight);
CREATE INDEX idx_comment_sentiment ON comment(sentiment);
CREATE INDEX idx_comment_quality_score ON comment(quality_score);



-- 创建评论举报表
CREATE TABLE comment_report (
                                id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
                                comment_id BIGINT NOT NULL COMMENT '被举报的评论ID',
                                user_id BIGINT NOT NULL COMMENT '举报人ID',
                                reason VARCHAR(255) NOT NULL COMMENT '举报原因',
                                status VARCHAR(20) DEFAULT 'pending' NOT NULL COMMENT '举报状态',
                                feedback TEXT COMMENT '处理反馈',
                                handler_id BIGINT COMMENT '处理人ID',
                                handle_time DATETIME COMMENT '处理时间',
                                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
                                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
                                is_deleted BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否删除',

                                INDEX idx_comment_id (comment_id),
                                INDEX idx_user_id (user_id),
                                INDEX idx_status (status),
                                INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='评论举报表';

-- 添加外键约束
ALTER TABLE comment_report
    ADD CONSTRAINT fk_comment_report_comment_id
        FOREIGN KEY (comment_id) REFERENCES comment(id)
            ON DELETE CASCADE;