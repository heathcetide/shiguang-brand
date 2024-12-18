package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.entity.PostLikes;

/**
* @author Lenovo
* @description 针对表【post_likes】的数据库操作Service
* @createDate 2024-12-02 21:47:52
*/
public interface PostLikesService extends IService<PostLikes> {

    boolean existsByPostIdAndUserId(Long postId, Long userId);

    boolean removeByPostIdAndUserId(Long postId, Long userId);

    Boolean insert(PostLikes like);
}
