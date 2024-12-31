package com.foodrecord.service.impl;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.VideoShareMapper;
import com.foodrecord.model.entity.video.VideoShare;
import com.foodrecord.service.VideoShareService;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.UUID;

@Service
public class VideoShareServiceImpl implements VideoShareService {

    @Resource
    private VideoShareMapper videoShareMapper;

    @Override
    public ApiResponse shareVideo(Long videoId, Long userId, String platform) {
        try {
            // 1. 生成分享链接
            String shareUrl = generateShareUrl(videoId, platform);
            
            // 2. 记录分享
            VideoShare share = new VideoShare();
            share.setVideoId(videoId);
            share.setUserId(userId);
            share.setPlatform(platform);
            share.setShareUrl(shareUrl);
            share.setCreatedAt(new Date());
            videoShareMapper.insert(share);
            
            // 3. 返回分享信息
            Map<String, Object> result = new HashMap<>();
            result.put("shareUrl", shareUrl);
            result.put("platform", platform);
            
            return ApiResponse.success(result);
        } catch (Exception e) {
            return ApiResponse.error(300, "分享视频失败：" + e.getMessage());
        }
    }

    private String generateShareUrl(Long videoId, String platform) {
        // TODO: 根据不同平台生成对应的分享链接
        return String.format("https://your-domain.com/share/%s/%s", videoId, platform);
    }

    @Override
    public ApiResponse getVideoShares(Long videoId, Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Map<String, Object>> shares = videoShareMapper.selectByVideoId(videoId, offset, pageSize);
            return ApiResponse.success(shares);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取视频分享记录失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getUserShares(Long userId, Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Map<String, Object>> shares = videoShareMapper.selectByUserId(userId, offset, pageSize);
            return ApiResponse.success(shares);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取用户分享记录失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getShareStats(Long videoId) {
        try {
            Map<String, Object> stats = videoShareMapper.selectShareStats(videoId);
            return ApiResponse.success(stats);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取分享统计失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse generateShareLink(Long videoId, Long userId, String platform) {
        try {
            // 1. 生成唯一的分享码
            String shareCode = UUID.randomUUID().toString().substring(0, 8);
            
            // 2. 构建分享链接
            String shareUrl = String.format("https://your-domain.com/share/%s/%s/%s", 
                                          platform, videoId, shareCode);
            
            // 3. 保存分享记录
            VideoShare share = new VideoShare();
            share.setVideoId(videoId);
            share.setUserId(userId);
            share.setPlatform(platform);
            share.setShareUrl(shareUrl);
//            share.setShareCode(shareCode);
            share.setCreatedAt(new Date());
            videoShareMapper.insert(share);
            
            return ApiResponse.success(shareUrl);
        } catch (Exception e) {
            return ApiResponse.error(300, "生成分享链接失败：" + e.getMessage());
        }
    }
} 