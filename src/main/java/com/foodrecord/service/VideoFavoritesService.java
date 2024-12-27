package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;

public interface VideoFavoritesService {
    ApiResponse favoriteVideo(Long videoId, Long userId);
    ApiResponse unfavoriteVideo(Long videoId, Long userId);
    ApiResponse getUserFavorites(Long userId, Integer pageNum, Integer pageSize);
    boolean hasFavorited(Long videoId, Long userId);
}
