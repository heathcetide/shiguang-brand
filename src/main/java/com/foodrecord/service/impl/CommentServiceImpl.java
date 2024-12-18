package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.mapper.CommentMapper;
import com.foodrecord.model.entity.Comment;
import com.foodrecord.service.CommentService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
* @author Lenovo
* @description 针对表【comment】的数据库操作Service实现
* @createDate 2024-12-02 21:47:52
*/
@Service
public class CommentServiceImpl extends ServiceImpl<CommentMapper, Comment>
    implements CommentService {

    @Autowired
    private CommentMapper commentMapper;

    @Override
    public List<Comment> getCommentList(String postId) {
        return commentMapper.getListByPostId(postId);
    }

    @Override
    public boolean insert(Comment comment) {
        return commentMapper.save(comment);
    }

    @Override
    public boolean delete(Long id) {
        return commentMapper.removeById(id);
    }

    @Override
    public Comment selectById(Long id) {
        return commentMapper.getById(id);
    }

    @Override
    public List<Comment> getList() {
        return commentMapper.getCommentList();
    }

    @Override
    public List<Comment> getCommentListBatch(String postId) {
        try {
            return commentMapper.selectBatchByPostId(postId);
        } catch (Exception e) {
            log.error("批量获取评论失败，postId: " + postId, e);
            return new ArrayList<>();
        }
    }

    @Override
    public Long getCommentCount(String postId) {
        try {
            return commentMapper.selectCommentCount(postId);
        } catch (Exception e) {
            log.error("获取评论数量失败，postId: " + postId, e);
            return 0L;
        }
    }

    @Override
    public boolean updateContent(Comment comment) {
        return commentMapper.updateComment(comment.getId(),comment.getContent());
    }
}




