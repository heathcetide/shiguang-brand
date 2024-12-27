package com.foodrecord.model.dto;

import com.baomidou.mybatisplus.annotation.TableField;
import com.foodrecord.model.entity.Comment;

import java.io.Serializable;

public class AddCommentRequest implements Serializable {
    /**
     *
     */
    private Long postId;

    /**
     *
     */
    private String content;

    /**
     *
     */
    private Long parentId;

    @TableField(exist = false)
    private static final long serialVersionUID = 1L;

    public Long getPostId() {
        return postId;
    }

    public void setPostId(Long postId) {
        this.postId = postId;
    }

    /**
     *
     */
    public String getContent() {
        return content;
    }

    /**
     *
     */
    public void setContent(String content) {
        this.content = content;
    }

    /**
     *
     */
    public Long getParentId() {
        return parentId;
    }

    /**
     *
     */
    public void setParentId(Long parentId) {
        this.parentId = parentId;
    }


    public Comment toComment() {
        Comment comment = new Comment();
        comment.setPostId(this.getPostId());
        comment.setContent(this.getContent());
        comment.setParentId(this.getParentId());
        return comment;

    }
}
