package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;

public interface VideoLikesService {
    ApiResponse likeVideo(Long videoId, Long userId);
    ApiResponse unlikeVideo(Long videoId, Long userId);
    boolean hasLiked(Long videoId, Long userId);
}
