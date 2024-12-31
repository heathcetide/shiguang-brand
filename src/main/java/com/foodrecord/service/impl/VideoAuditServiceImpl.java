package com.foodrecord.service.impl;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.VideoAuditRecordMapper;
import com.foodrecord.mapper.VideosMapper;
import com.foodrecord.model.entity.video.VideoAuditRecord;
import com.foodrecord.model.entity.video.Videos;
import com.foodrecord.service.VideoAuditService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.HashMap;

@Service
public class VideoAuditServiceImpl implements VideoAuditService {

    @Resource
    private VideosMapper videosMapper;

    @Resource
    private VideoAuditRecordMapper videoAuditRecordMapper;

    @Override
    @Transactional
    public ApiResponse submitAudit(Long videoId) {
        try {
            // 1. 验证视频是否存在
            Videos video = videosMapper.selectById(videoId);
            if (video == null) {
                return ApiResponse.error(300, "视频不存在");
            }

            // 2. 创建审核记录
            VideoAuditRecord auditRecord = new VideoAuditRecord();
            auditRecord.setVideoId(videoId);
            auditRecord.setStatus(0); // 待审核
            auditRecord.setCreatedAt(new Date());
            videoAuditRecordMapper.insert(auditRecord);

            return ApiResponse.success("提交审核成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "提交审核失败：" + e.getMessage());
        }
    }

    @Override
    @Transactional
    public ApiResponse auditVideo(Long videoId, Integer status, String reason) {
        try {
            // 1. 验证视频是否存在
            Videos video = videosMapper.selectById(videoId);
            if (video == null) {
                return ApiResponse.error(300, "视频不存在");
            }

            // 2. 更新审核记录
            VideoAuditRecord auditRecord = videoAuditRecordMapper.selectLatestByVideoId(videoId);
            if (auditRecord == null) {
                return ApiResponse.error(300, "审核记录不存在");
            }

            auditRecord.setStatus(status);
            auditRecord.setReason(reason);
            auditRecord.setUpdatedAt(new Date());
            videoAuditRecordMapper.updateById(auditRecord);

            // 3. 更新视频状态
//            video.setStatus(status);
            video.setUpdatedAt(new Date());
            videosMapper.updateVideo(video);

            return ApiResponse.success("审核完成");
        } catch (Exception e) {
            return ApiResponse.error(300, "审核失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getAuditRecords(Long videoId) {
        try {
            List<VideoAuditRecord> records = videoAuditRecordMapper.selectByVideoId(videoId);
            return ApiResponse.success(records);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取审核记录失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getPendingAuditList(Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<VideoAuditRecord> records = videoAuditRecordMapper.selectPendingList(offset, pageSize);
            return ApiResponse.success(records);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取待审核列表失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getAuditStatus(Long videoId) {
        try {
            Map<String, Object> auditInfo = videoAuditRecordMapper.selectLatestAudit(videoId);
            
            if (auditInfo == null) {
                return ApiResponse.error(300, "未找到审核记录");
            }
            
            // 构建返回数据
            Map<String, Object> result = new HashMap<>();
            result.put("status", auditInfo.get("status"));
            result.put("reason", auditInfo.get("reason"));
            result.put("auditTime", auditInfo.get("audit_time"));
            result.put("auditor", auditInfo.get("auditor_name"));
            
            return ApiResponse.success(result);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取审核状态失败：" + e.getMessage());
        }
    }
} 