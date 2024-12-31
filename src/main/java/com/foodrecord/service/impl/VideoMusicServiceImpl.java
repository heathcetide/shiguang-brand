package com.foodrecord.service.impl;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.VideoMusicMapper;
import com.foodrecord.model.entity.video.VideoMusic;
import com.foodrecord.service.VideoMusicService;
import com.foodrecord.util.FFmpegUtil;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class VideoMusicServiceImpl implements VideoMusicService {

    @Resource
    private VideoMusicMapper videoMusicMapper;

    @Resource
    private FFmpegUtil ffmpegUtil;

    @Override
    public ApiResponse addBackgroundMusic(Long videoId, Long musicId, Integer startTime, Integer duration, Float volume) {
        try {
            // 1. 验证音乐是否存在
            VideoMusic music = videoMusicMapper.selectById(musicId);
            if (music == null) {
                return ApiResponse.error(300, "音乐不存在");
            }
            
            // 2. 创建音乐使用记录
            videoMusicMapper.insertMusicUse(videoId, musicId, startTime, duration, volume);
            
            // 3. 更新音乐使用次数
            videoMusicMapper.incrementUseCount(musicId);
            
            // 4. 异步处理音频合成
            // TODO: 调用FFmpeg进行音频合成
            
            return ApiResponse.success("添加背景音乐成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "添加背景音乐失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse removeBackgroundMusic(Long videoId) {
        try {
            // 1. 删除音乐使用记录
            videoMusicMapper.deleteMusicUse(videoId);
            
            // 2. 异步处理音频移除
            // TODO: 调用FFmpeg移除音频
            
            return ApiResponse.success("移除背景音乐成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "移除背景音乐失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getMusicList(Integer pageNum, Integer pageSize, String category) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Map<String, Object>> musics = videoMusicMapper.selectMusicList(offset, pageSize, category);
            
            // 获取总数
            int total = videoMusicMapper.countMusic(category);
            
            Map<String, Object> result = new HashMap<>();
            result.put("list", musics);
            result.put("total", total);
            result.put("pageNum", pageNum);
            result.put("pageSize", pageSize);
            
            return ApiResponse.success(result);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取音乐列表失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getMusicDetail(Long musicId) {
        try {
            VideoMusic music = videoMusicMapper.selectById(musicId);
            if (music == null) {
                return ApiResponse.error(300, "音乐不存在");
            }
            return ApiResponse.success(music);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取音乐详情失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse searchMusic(String keyword, Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Map<String, Object>> musics = videoMusicMapper.searchMusic(keyword, offset, pageSize);
            
            // 获取搜索结果总数
            int total = videoMusicMapper.countSearchMusic(keyword);
            
            Map<String, Object> result = new HashMap<>();
            result.put("list", musics);
            result.put("total", total);
            result.put("pageNum", pageNum);
            result.put("pageSize", pageSize);
            
            return ApiResponse.success(result);
        } catch (Exception e) {
            return ApiResponse.error(300, "搜索音乐失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getHotMusic(Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Map<String, Object>> musics = videoMusicMapper.selectHotMusic(offset, pageSize);
            return ApiResponse.success(musics);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取热门音乐失败：" + e.getMessage());
        }
    }
} 