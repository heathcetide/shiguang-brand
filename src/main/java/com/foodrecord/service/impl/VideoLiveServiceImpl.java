package com.foodrecord.service.impl;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.VideoLiveMapper;
import com.foodrecord.model.entity.video.VideoLive;
import com.foodrecord.service.VideoLiveService;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.HashMap;

@Service
public class VideoLiveServiceImpl implements VideoLiveService {

    @Resource
    private VideoLiveMapper videoLiveMapper;

    @Override
    public ApiResponse startLiveStream(Long userId, String title, String description) {
        try {
            VideoLive live = new VideoLive();
            live.setUserId(userId);
            live.setTitle(title);
//            live.setDescription(description);
            live.setStatus(0); // 未开始
            live.setOnlineCount(0);
            
            // 生成推流和拉流地址
            String streamKey = UUID.randomUUID().toString();
            live.setPushUrl("rtmp://push.your-domain.com/live/" + streamKey);
            live.setPullUrl("rtmp://pull.your-domain.com/live/" + streamKey);
            
            live.setCreatedAt(new Date());
            videoLiveMapper.insert(live);
            
            return ApiResponse.success(live);
        } catch (Exception e) {
            return ApiResponse.error(300, "创建直播失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse endLiveStream(String streamId, Long userId) {
        try {
            VideoLive live = videoLiveMapper.selectByStreamId(streamId);
            if (live == null) {
                return ApiResponse.error(300, "直播不存在");
            }
            
            if (!live.getUserId().equals(userId)) {
                return ApiResponse.error(300, "无权操作此直播");
            }
            
            live.setStatus(2); // 已结束
            live.setEndTime(new Date());
            videoLiveMapper.updateById(live);
            
            return ApiResponse.success("结束直播成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "结束直播失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getLiveStreamInfo(String streamId) {
        try {
            Map<String, Object> liveInfo = videoLiveMapper.selectLiveInfo(streamId);
            if (liveInfo == null) {
                return ApiResponse.error(300, "直播不存在");
            }
            return ApiResponse.success(liveInfo);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取直播信息失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getLiveStreams(Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Map<String, Object>> lives = videoLiveMapper.selectLiveList(1, offset, pageSize);
            
            // 获取直播总数
            int total = videoLiveMapper.countLives();
            
            Map<String, Object> result = new HashMap<>();
            result.put("list", lives);
            result.put("total", total);
            result.put("pageNum", pageNum);
            result.put("pageSize", pageSize);
            
            return ApiResponse.success(result);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取直播列表失败：" + e.getMessage());
        }
    }
} 