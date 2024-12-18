package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.entity.Comment;


import java.util.List;

/**
* @author Lenovo
* @description 针对表【comment】的数据库操作Service
* @createDate 2024-12-02 21:47:52
*/
public interface CommentService extends IService<Comment> {

    List<Comment> getCommentList(String postId);

    boolean insert(Comment comment);

    boolean delete(Long id);

    Comment selectById(Long id);

    List<Comment> getList();

    /**
     * 批量获取评论列表
     * @param postId 帖子ID
     * @return 评论列表
     */
    List<Comment> getCommentListBatch(String postId);

    /**
     * 获取帖子的评论数量
     * @param postId 帖子ID
     * @return 评论数量
     */
    Long getCommentCount(String postId);

    boolean updateContent(Comment comment);
}
