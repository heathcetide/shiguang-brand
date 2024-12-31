package com.foodrecord.service.impl;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.VideoSubtitleMapper;
import com.foodrecord.mapper.VideosMapper;
import com.foodrecord.model.entity.video.VideoSubtitle;
import com.foodrecord.model.entity.video.Videos;
import com.foodrecord.service.VideoSubtitleService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import java.util.Date;
import java.util.List;

@Service
public class VideoSubtitleServiceImpl implements VideoSubtitleService {

    @Resource
    private VideosMapper videosMapper;

    @Resource
    private VideoSubtitleMapper videoSubtitleMapper;

    @Override
    @Transactional
    public ApiResponse uploadSubtitle(Long videoId, String language, MultipartFile subtitleFile) {
        try {
            // 1. 验证视频是否存在
            Videos video = videosMapper.selectById(videoId);
            if (video == null) {
                return ApiResponse.error(300, "视频不存在");
            }

            // 2. 读取并验证字幕文件内容
            String content = new String(subtitleFile.getBytes());
            // TODO: 验证SRT格式

            // 3. 保存字幕
            VideoSubtitle subtitle = videoSubtitleMapper.selectByVideoIdAndLanguage(videoId, language);
            if (subtitle == null) {
                subtitle = new VideoSubtitle();
                subtitle.setVideoId(videoId);
                subtitle.setLanguage(language);
                subtitle.setIsAuto(false);
                subtitle.setStatus(1);
                subtitle.setCreatedAt(new Date());
            }
            subtitle.setContent(content);
            subtitle.setUpdatedAt(new Date());

            if (subtitle.getId() == null) {
                videoSubtitleMapper.insert(subtitle);
            } else {
                videoSubtitleMapper.updateById(subtitle);
            }

            return ApiResponse.success("上传字幕成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "上传字幕失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse generateSubtitle(Long videoId, String language) {
        try {
            // 1. 验证视频是否存在
            Videos video = videosMapper.selectById(videoId);
            if (video == null) {
                return ApiResponse.error(300, "视频不存在");
            }

            // 2. 调用语音识别服务生成字幕
            // TODO: 实现异步字幕生成

            return ApiResponse.success("字幕生成任务已提交");
        } catch (Exception e) {
            return ApiResponse.error(300, "生成字幕失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getSubtitleList(Long videoId) {
        try {
            List<VideoSubtitle> subtitles = videoSubtitleMapper.selectByVideoId(videoId);
            return ApiResponse.success(subtitles);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取字幕列表失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getSubtitle(Long videoId, String language) {
        try {
            VideoSubtitle subtitle = videoSubtitleMapper.selectByVideoIdAndLanguage(videoId, language);
            if (subtitle == null) {
                return ApiResponse.error(300, "字幕不存在");
            }
            return ApiResponse.success(subtitle);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取字幕失败：" + e.getMessage());
        }
    }

    @Override
    @Transactional
    public ApiResponse deleteSubtitle(Long videoId, String language) {
        try {
            VideoSubtitle subtitle = videoSubtitleMapper.selectByVideoIdAndLanguage(videoId, language);
            if (subtitle == null) {
                return ApiResponse.error(300, "字幕不存在");
            }

            subtitle.setStatus(0);
            subtitle.setUpdatedAt(new Date());
            videoSubtitleMapper.updateById(subtitle);

            return ApiResponse.success("删除字幕成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "删除字幕失败：" + e.getMessage());
        }
    }
} 