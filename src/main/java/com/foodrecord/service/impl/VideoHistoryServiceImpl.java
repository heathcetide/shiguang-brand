package com.foodrecord.service.impl;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.VideoHistoryMapper;
import com.foodrecord.mapper.VideosMapper;
import com.foodrecord.model.entity.video.VideoWatchHistory;
import com.foodrecord.service.VideoHistoryService;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.Date;
import java.util.List;
import java.util.Map;

@Service
public class VideoHistoryServiceImpl implements VideoHistoryService {

    @Resource
    private VideoHistoryMapper videoHistoryMapper;

    @Resource
    private VideosMapper videosMapper;

    @Override
    public ApiResponse addHistory(Long userId, Long videoId, Integer watchDuration) {
        try {
            VideoWatchHistory history = videoHistoryMapper.selectByUserAndVideo(userId, videoId);
            if (history == null) {
                history = new VideoWatchHistory();
                history.setUserId(userId);
                history.setVideoId(videoId);
//                history.setWatchCount(1);
                history.setCreatedAt(new Date());
            } else {
//                history.setWatchCount(history.getWatchCount() + 1);
            }
            
            history.setWatchDuration(watchDuration);
//            history.setWatchTime(new Date());
            history.setUpdatedAt(new Date());

            if (history.getId() == null) {
                videoHistoryMapper.insert(history);
            } else {
                videoHistoryMapper.updateById(history);
            }

            return ApiResponse.success("添加观看记录成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "添加观看记录失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getUserHistory(Long userId, Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Map<String, Object>> histories = videoHistoryMapper.selectUserHistory(userId, offset, pageSize);
            return ApiResponse.success(histories);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取观看历史失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse clearHistory(Long userId) {
        try {
            videoHistoryMapper.deleteByUserId(userId);
            return ApiResponse.success("清除观看记录成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "清除观看记录失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse deleteHistory(Long userId, Long videoId) {
        try {
            videoHistoryMapper.deleteByUserAndVideo(userId, videoId);
            return ApiResponse.success("删除观看记录成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "删除观看记录失败：" + e.getMessage());
        }
    }
} 