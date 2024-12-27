package com.foodrecord.service.impl;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.VideoCommentsMapper;
import com.foodrecord.mapper.VideosMapper;
import com.foodrecord.model.entity.video.VideoComments;
import com.foodrecord.service.VideoCommentsService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.List;
import java.util.Map;

@Service
public class VideoCommentsServiceImpl implements VideoCommentsService {

    @Resource
    private VideoCommentsMapper videoCommentsMapper;

    @Resource
    private VideosMapper videosMapper;

    @Override
    @Transactional
    public ApiResponse addComment(VideoComments comment) {
        try {
            // 检查父评论是否存在
            if (comment.getParentId() != null) {
                VideoComments parentComment = videoCommentsMapper.selectById(comment.getParentId());
                if (parentComment == null) {
                    return ApiResponse.error(300, "父评论不存在");
                }
            }

            int rows = videoCommentsMapper.save(comment);
            if (rows > 0) {
                // 更新视频评论数
                videosMapper.incrementViewCount(comment.getVideoId());
                return ApiResponse.success(comment);
            }
            return ApiResponse.error(300, "评论失败");
        } catch (Exception e) {
            return ApiResponse.error(300, "发表评论失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getVideoComments(Long videoId, Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Map<String, Object>> comments = videoCommentsMapper.selectVideoComments(videoId, offset, pageSize);
            return ApiResponse.success(comments);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取评论失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse deleteComment(Long id, Long userId) {
        try {
            int rows = videoCommentsMapper.deleteComment(id, userId);
            if (rows > 0) {
                return ApiResponse.success( "删除成功");
            }
            return ApiResponse.error(300, "删除失败，评论不存在或无权限");
        } catch (Exception e) {
            return ApiResponse.error(300, "删除评论失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse updateComment(VideoComments comment) {
        try {
            int rows = videoCommentsMapper.updateComment(comment);
            if (rows > 0) {
                return ApiResponse.success("更新成功");
            }
            return ApiResponse.error(300, "更新失败，评论不存在或无权限");
        } catch (Exception e) {
            return ApiResponse.error(300, "更新评论失败：" + e.getMessage());
        }
    }
}




