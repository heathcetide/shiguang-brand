package com.foodrecord.service.impl;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.VideoReportMapper;
import com.foodrecord.model.entity.video.VideoReport;
import com.foodrecord.service.VideoReportService;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.Date;
import java.util.List;
import java.util.Map;

@Service
public class VideoReportServiceImpl implements VideoReportService {

    @Resource
    private VideoReportMapper videoReportMapper;

    @Override
    public ApiResponse reportVideo(Long videoId, Long userId, String reason, String description) {
        try {
            VideoReport report = new VideoReport();
            report.setVideoId(videoId);
//            report.setUserId(userId);
            report.setReason(reason);
            report.setDescription(description);
            report.setStatus(0); // 待处理
            report.setCreatedAt(new Date());
            videoReportMapper.insert(report);
            
            return ApiResponse.success(report);
        } catch (Exception e) {
            return ApiResponse.error(300, "举报失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getReportStatus(Long reportId) {
        try {
            VideoReport report = videoReportMapper.selectById(reportId);
            if (report == null) {
                return ApiResponse.error(300, "举报记录不存在");
            }
            return ApiResponse.success(report);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取举报状态失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse handleReport(Long reportId, Integer status, String feedback) {
        try {
            VideoReport report = videoReportMapper.selectById(reportId);
            if (report == null) {
                return ApiResponse.error(300, "举报记录不存在");
            }
            
            report.setStatus(status);
//            report.setFeedback(feedback);
//            report.setHandleTime(new Date());
            videoReportMapper.updateById(report);
            
            return ApiResponse.success("处理成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "处理举报失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getUserReports(Long userId, Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Map<String, Object>> reports = videoReportMapper.selectByUserId(userId, offset, pageSize);
            return ApiResponse.success(reports);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取用户举报记录失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getVideoReports(Long videoId, Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Map<String, Object>> reports = videoReportMapper.selectByVideoId(videoId, offset, pageSize);
            return ApiResponse.success(reports);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取视频举报记录失败：" + e.getMessage());
        }
    }
} 