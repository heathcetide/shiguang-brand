package com.foodrecord.service.impl;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.VideoFavoritesMapper;
import com.foodrecord.model.entity.video.VideoFavorites;
import com.foodrecord.service.VideoFavoritesService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.List;
import java.util.Map;

@Service
public class VideoFavoritesServiceImpl implements VideoFavoritesService {

    @Resource
    private VideoFavoritesMapper videoFavoritesMapper;

    @Override
    @Transactional
    public ApiResponse favoriteVideo(Long videoId, Long userId) {
        try {
            if (hasFavorited(videoId, userId)) {
                return ApiResponse.error(300, "已经收藏过了");
            }

            VideoFavorites favorite = new VideoFavorites();
            favorite.setVideoId(videoId);
            favorite.setUserId(userId);

            int rows = videoFavoritesMapper.save(favorite);
            if (rows > 0) {
                return ApiResponse.success( "收藏成功");
            }
            return ApiResponse.error(300, "收藏失败");
        } catch (Exception e) {
            return ApiResponse.error(300, "收藏失败：" + e.getMessage());
        }
    }

    @Override
    @Transactional
    public ApiResponse unfavoriteVideo(Long videoId, Long userId) {
        try {
            if (!hasFavorited(videoId, userId)) {
                return ApiResponse.error(300, "还没有收藏");
            }

            int rows = videoFavoritesMapper.delete(videoId, userId);
            if (rows > 0) {
                return ApiResponse.success("取消收藏成功");
            }
            return ApiResponse.error(300, "取消收藏失败");
        } catch (Exception e) {
            return ApiResponse.error(300, "取消收藏失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getUserFavorites(Long userId, Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Map<String, Object>> favorites = videoFavoritesMapper.selectUserFavorites(userId, offset, pageSize);
            return ApiResponse.success(favorites);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取收藏列表失败：" + e.getMessage());
        }
    }

    @Override
    public boolean hasFavorited(Long videoId, Long userId) {
        return videoFavoritesMapper.checkFavoriteExists(videoId, userId) > 0;
    }
}




