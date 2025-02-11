package com.foodrecord.service.impl;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.VideoWatermarkMapper;
import com.foodrecord.model.entity.video.VideoWatermark;
import com.foodrecord.service.VideoWatermarkService;
import com.foodrecord.common.utils.FFmpegUtil;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.HashMap;

@Service
public class VideoWatermarkServiceImpl implements VideoWatermarkService {

    @Resource
    private VideoWatermarkMapper videoWatermarkMapper;

    @Resource
    private FFmpegUtil ffmpegUtil;

    @Override
    public ApiResponse addWatermark(Long videoId, String watermarkText, 
                                  String position, Float opacity) {
        try {
            VideoWatermark watermark = new VideoWatermark();
            watermark.setVideoId(videoId);
//            watermark.setType("text");
            watermark.setContent(watermarkText);
            watermark.setPosition(position);
            watermark.setSize(24);
            watermark.setOpacity(opacity);
            watermark.setCreatedAt(new Date());
            videoWatermarkMapper.insert(watermark);
            
            return ApiResponse.success("添加水印成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "添加水印失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse updateWatermark(Long watermarkId, String content, 
                                     String position, Integer size, Float opacity) {
        try {
            videoWatermarkMapper.updateWatermark(watermarkId, content, position, size, opacity);
            return ApiResponse.success("更新水印成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "更新水印失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse deleteWatermark(Long watermarkId) {
        try {
            videoWatermarkMapper.deleteById(watermarkId);
            return ApiResponse.success("删除水印成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "删除水印失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getVideoWatermarks(Long videoId) {
        try {
            List<VideoWatermark> watermarks = videoWatermarkMapper.selectByVideoId(videoId);
            return ApiResponse.success(watermarks);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取水印列表失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse applyWatermark(Long videoId, Long watermarkId) {
        try {
            VideoWatermark watermark = videoWatermarkMapper.selectById(watermarkId);
            if (watermark == null) {
                return ApiResponse.error(300, "水印不存在");
            }
            
            // TODO: 调用FFmpeg添加水印
            // 根据水印类型(文字/图片)、位置、大小、透明度等参数构建FFmpeg命令
            
            return ApiResponse.success("应用水印成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "应用水印失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse previewWatermark(Long videoId, String watermarkText, String position) {
        try {
            // 1. 验证参数
            if (watermarkText == null || watermarkText.trim().isEmpty()) {
                return ApiResponse.error(300, "水印文字不能为空");
            }
            
            // 2. 生成水印预览图
            Map<String, Object> preview = new HashMap<>();
            preview.put("watermarkText", watermarkText);
            preview.put("position", position);
            preview.put("previewUrl", generatePreviewUrl(videoId, watermarkText, position));
            
            return ApiResponse.success(preview);
        } catch (Exception e) {
            return ApiResponse.error(300, "生成水印预览失败：" + e.getMessage());
        }
    }

    private String generatePreviewUrl(Long videoId, String watermarkText, String position) {
        // TODO: 实现水印预览图生成逻辑
        return "https://your-domain.com/watermark/preview/" + videoId;
    }
} 