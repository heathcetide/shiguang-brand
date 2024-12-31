package com.foodrecord.service.impl;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.VideoCommentsMapper;
import com.foodrecord.mapper.VideosMapper;
import com.foodrecord.model.entity.video.VideoComments;
import com.foodrecord.service.VideoCommentsService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.HashMap;

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

            int rows = videoCommentsMapper.insert(comment);
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

    @Override
    public ApiResponse replyToComment(Long commentId, Long userId, String content) {
        try {
            // 1. 验证父评论是否存在
            VideoComments parentComment = videoCommentsMapper.selectById(commentId);
            if (parentComment == null) {
                return ApiResponse.error(300, "评论不存在");
            }
            
            // 2. 创建回复评论
            VideoComments reply = new VideoComments();
            reply.setVideoId(parentComment.getVideoId());
            reply.setUserId(userId);
            reply.setContent(content);
            reply.setParentId(commentId);
            reply.setCreatedAt(new Date());
            videoCommentsMapper.insert(reply);
            
            // 3. 更新父评论的回复数
            videoCommentsMapper.incrementReplyCount(commentId);
            
            return ApiResponse.success(reply);
        } catch (Exception e) {
            return ApiResponse.error(300, "回复评论失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getCommentReplies(Long commentId, Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Map<String, Object>> replies = videoCommentsMapper.selectReplies(commentId, offset, pageSize);
            
            // 获取回复总数
            int total = videoCommentsMapper.countReplies(commentId);
            
            Map<String, Object> result = new HashMap<>();
            result.put("list", replies);
            result.put("total", total);
            result.put("pageNum", pageNum);
            result.put("pageSize", pageSize);
            
            return ApiResponse.success(result);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取评论回复失败：" + e.getMessage());
        }
    }
}




