package com.foodrecord.service.impl;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.VideoTagsMapper;
import com.foodrecord.model.entity.video.VideoTags;
import com.foodrecord.service.VideoTagsService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.List;
import java.util.Map;

/**
* @author Lenovo
* @description 针对表【video_tags(视频标签表)】的数据库操作Service实现
* @createDate 2024-12-05 19:08:10
*/
@Service
public class VideoTagsServiceImpl implements VideoTagsService {

    @Resource
    private VideoTagsMapper videoTagsMapper;

    @Override
    @Transactional
    public ApiResponse addTags(Long videoId, List<String> tags) {
        try {
            // 获取现有标签
            List<String> existingTags = videoTagsMapper.selectVideoTags(videoId);
            
            for (String tag : tags) {
                // 跳过已存在的标签
                if (existingTags.contains(tag)) {
                    continue;
                }
                
                VideoTags videoTag = new VideoTags();
                videoTag.setVideoId(videoId);
                videoTag.setTag(tag);
                videoTagsMapper.save(videoTag);
            }
            return ApiResponse.success( "添加标签成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "添加标签失败：" + e.getMessage());
        }
    }

    @Override
    @Transactional
    public ApiResponse removeTags(Long videoId, List<String> tags) {
        try {
            for (String tag : tags) {
                videoTagsMapper.delete(videoId, tag);
            }
            return ApiResponse.success("移除标签成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "移除标签失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getVideoTags(Long videoId) {
        try {
            List<String> tags = videoTagsMapper.selectVideoTags(videoId);
            return ApiResponse.success(tags);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取视频标签失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getVideosByTag(String tag, Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Map<String, Object>> videos = videoTagsMapper.selectVideosByTag(tag, offset, pageSize);
            return ApiResponse.success(videos);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取标签视频失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getPopularTags(Integer limit) {
        try {
            List<Map<String, Object>> tags = videoTagsMapper.selectPopularTags(limit);
            return ApiResponse.success(tags);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取热门标签失败：" + e.getMessage());
        }
    }
}




