package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.service.VideoEditService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.util.List;
import java.util.Map;

@Api(tags = "视频编辑接口")
@RestController
@RequestMapping("/api/video/edit")
public class VideoEditController {

    @Resource
    private VideoEditService videoEditService;

    @ApiOperation("裁剪视频")
    @PostMapping("/trim")
    public ApiResponse trimVideo(
            @RequestParam Long videoId,
            @RequestParam Integer startTime,
            @RequestParam Integer endTime) {
        return videoEditService.trimVideo(videoId, startTime, endTime);
    }

    @ApiOperation("合并视频")
    @PostMapping("/merge")
    public ApiResponse mergeVideos(
            @RequestParam List<Long> videoIds,
            @RequestParam String title,
            @RequestParam(required = false) String description) {
        return videoEditService.mergeVideos(videoIds, title, description);
    }

    @ApiOperation("添加视频滤镜")
    @PostMapping("/filter")
    public ApiResponse addVideoFilter(
            @RequestParam Long videoId,
            @RequestParam String filterType,
            @RequestBody Map<String, Object> filterParams) {
        return videoEditService.addVideoFilter(videoId, filterType, filterParams);
    }

    @ApiOperation("添加视频文字")
    @PostMapping("/text")
    public ApiResponse addVideoText(
            @RequestParam Long videoId,
            @RequestParam String text,
            @RequestParam Integer startTime,
            @RequestParam Integer duration,
            @RequestBody Map<String, Object> textStyle) {
        return videoEditService.addVideoText(videoId, text, startTime, duration, textStyle);
    }

    @ApiOperation("获取编辑进度")
    @GetMapping("/progress/{taskId}")
    public ApiResponse getEditProgress(@PathVariable String taskId) {
        return videoEditService.getEditProgress(taskId);
    }
} 