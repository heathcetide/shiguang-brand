package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.entity.Post;

import java.util.List;

/**
* @author Lenovo
* @description 针对表【post】的数据库操作Service
* @createDate 2024-12-02 21:47:52
*/
public interface PostService extends IService<Post> {

    /**
     * 获取热门帖子ID列表
     * 根据点赞数、评论数等指标来判断热门帖子
     * @return 热门帖子ID列表
     */
    List<Long> getHotPostIds();

    Post selectById(Long postId);

    List<Post> getList();

    Boolean updatePostById(Post post);

    Boolean insert(Post post);

    Post getPostById(Long postId);

    Boolean upLikesCountById(Post post);

    Boolean downLikesCountById(Post post);

    boolean saveAll(List<Post> postList);
}
