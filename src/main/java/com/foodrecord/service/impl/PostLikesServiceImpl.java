package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.mapper.PostLikesMapper;
import com.foodrecord.model.entity.PostLikes;
import com.foodrecord.service.PostLikesService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
* @author Lenovo
* @description 针对表【post_likes】的数据库操作Service实现
* @createDate 2024-12-02 21:47:52
*/
@Service
public class PostLikesServiceImpl extends ServiceImpl<PostLikesMapper, PostLikes>
    implements PostLikesService {
    @Autowired
    private PostLikesMapper postLikesMapper;

    @Override
    public boolean existsByPostIdAndUserId(Long postId, Long userId) {
        PostLikes postLikes= postLikesMapper.finPostByPostIdAndUserId(postId,userId);
        return postLikes != null;
    }

    @Override
    public boolean removeByPostIdAndUserId(Long postId, Long userId) {
        QueryWrapper<PostLikes> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("post_id", postId);
        queryWrapper.eq("user_id", userId);
        int delete = postLikesMapper.deleteByWrapper(userId,postId);
        return delete > 0;
    }

    @Override
    public Boolean insert(PostLikes like) {
        return postLikesMapper.save(like);
    }
}




