package com.foodrecord.service;


import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.entity.video.VideoComments;

public interface VideoCommentsService {
    ApiResponse addComment(VideoComments comment);
    ApiResponse  getVideoComments(Long videoId, Integer pageNum, Integer pageSize);
    ApiResponse  deleteComment(Long id, Long userId);
    ApiResponse  updateComment(VideoComments comment);
}
