package com.foodrecord.constant;

import java.util.Random;

public interface PostConstants {

    /**
     * 帖子缓存key
     */
    String KEY_POST = "post:";

    /**
     * 帖子缓存过期时间
     */
    int POST_CACHE_TTL = 15 + new Random().nextInt(3); // 缓存过期时间（分钟）
}
