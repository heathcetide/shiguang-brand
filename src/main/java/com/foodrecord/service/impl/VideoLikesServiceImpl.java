package com.foodrecord.service.impl;


import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.VideoLikesMapper;
import com.foodrecord.model.entity.video.VideoLikes;
import com.foodrecord.service.VideoLikesService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.Date;

@Service
public class VideoLikesServiceImpl implements VideoLikesService {

    @Resource
    private VideoLikesMapper videoLikesMapper;

    @Override
    @Transactional
    public ApiResponse likeVideo(Long videoId, Long userId) {
        try {
            // 检查是否已经点赞
            if (hasLiked(videoId, userId)) {
                return ApiResponse.success("已经点赞过了");
            }

            // 创建点赞记录
            VideoLikes videoLike = new VideoLikes();
            videoLike.setVideoId(videoId);
            videoLike.setUserId(userId);
            videoLike.setCreatedAt(new Date());

            // 保存点赞记录
            int rows = videoLikesMapper.save(videoLike);
            if (rows > 0) {
                // 增加视频点赞数
                videoLikesMapper.incrementLikeCount(videoId);
                return ApiResponse.success("点赞成功");
            }
            return ApiResponse.error(300, "点赞失败");
        } catch (Exception e) {
            return ApiResponse.error(300, "点赞失败：" + e.getMessage());
        }
    }

    @Override
    @Transactional
    public ApiResponse unlikeVideo(Long videoId, Long userId) {
        try {
            // 检查是否已经点赞
            if (!hasLiked(videoId, userId)) {
                return ApiResponse.error(300, "还没有点赞");
            }

            // 删除点赞记录
            int rows = videoLikesMapper.delete(videoId, userId);
            if (rows > 0) {
                // 减少视频点赞数
                videoLikesMapper.decrementLikeCount(videoId);
                return ApiResponse.success("取消点赞成功");
            }
            return ApiResponse.error(300, "取消点赞失败");
        } catch (Exception e) {
            return ApiResponse.error(300, "取消点赞失败：" + e.getMessage());
        }
    }

    @Override
    public boolean hasLiked(Long videoId, Long userId) {
        try {
            return videoLikesMapper.checkLikeExists(videoId, userId) > 0;
        } catch (Exception e) {
            return false;
        }
    }
}




