package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.entity.video.VideoComments;

public interface VideoCommentsService {
    
    /**
     * 添加评论
     */
    ApiResponse addComment(VideoComments comment);
    
    /**
     * 获取视频评论列表
     */
    ApiResponse getVideoComments(Long videoId, Integer pageNum, Integer pageSize);
    
    /**
     * 删除评论
     */
    ApiResponse deleteComment(Long id, Long userId);
    
    /**
     * 更新评论
     */
    ApiResponse updateComment(VideoComments comment);

    /**
     * 回复评论
     */
    ApiResponse replyToComment(Long commentId, Long userId, String content);

    /**
     * 获取评论回复列表
     */
    ApiResponse getCommentReplies(Long commentId, Integer pageNum, Integer pageSize);
}
