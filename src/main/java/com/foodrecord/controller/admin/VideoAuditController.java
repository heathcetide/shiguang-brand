package com.foodrecord.controller.admin;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.service.VideoAuditService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;

@Api(tags = "视频审核接口")
@RestController
@RequestMapping("/admin/video/audit")
public class VideoAuditController {

    @Resource
    private VideoAuditService videoAuditService;

    @ApiOperation("获取待审核视频列表")
    @GetMapping("/pending")
    public ApiResponse getPendingList(
            @RequestParam(defaultValue = "1") Integer pageNum,
            @RequestParam(defaultValue = "10") Integer pageSize) {
        return videoAuditService.getPendingAuditList(pageNum, pageSize);
    }

    @ApiOperation("审核视频")
    @PostMapping("/review")
    public ApiResponse auditVideo(
            @RequestParam Long videoId,
            @RequestParam Integer status,
            @RequestParam(required = false) String reason) {
        return videoAuditService.auditVideo(videoId, status, reason);
    }

    @ApiOperation("获取视频审核记录")
    @GetMapping("/records/{videoId}")
    public ApiResponse getAuditRecords(@PathVariable Long videoId) {
        return videoAuditService.getAuditRecords(videoId);
    }
} 