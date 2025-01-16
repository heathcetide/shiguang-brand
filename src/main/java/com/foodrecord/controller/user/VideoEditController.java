package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.service.VideoEditService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
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


    /**
     * 裁剪视频
     *
     * @param videoId   视频ID
     * @param startTime 裁剪开始时间（秒）
     * @param endTime   裁剪结束时间（秒）
     * @return 包含裁剪结果的ApiResponse对象
     */
    @ApiOperation("裁剪视频")
    @PostMapping("/trim")
    public ApiResponse trimVideo(
            @ApiParam(value = "视频ID", required = true) @RequestParam Long videoId,
            @ApiParam(value = "裁剪开始时间（秒）", required = true) @RequestParam Integer startTime,
            @ApiParam(value = "裁剪结束时间（秒）", required = true) @RequestParam Integer endTime) {
        return videoEditService.trimVideo(videoId, startTime, endTime);
    }

    /**
     * 合并视频
     *
     * @param videoIds    视频ID列表
     * @param title       合并后的视频标题
     * @param description 合并后的视频描述（可选）
     * @return 包含合并结果的ApiResponse对象
     */
    @ApiOperation("合并视频")
    @PostMapping("/merge")
    public ApiResponse mergeVideos(
            @ApiParam(value = "视频ID列表", required = true) @RequestParam List<Long> videoIds,
            @ApiParam(value = "合并后的视频标题", required = true) @RequestParam String title,
            @ApiParam(value = "合并后的视频描述（可选）", required = false) @RequestParam(required = false) String description) {
        return videoEditService.mergeVideos(videoIds, title, description);
    }


    /**
     * 添加视频滤镜
     *
     * @param videoId      视频ID
     * @param filterType   滤镜类型
     * @param filterParams 滤镜参数
     * @return 包含添加滤镜结果的ApiResponse对象
     */
    @ApiOperation("添加视频滤镜")
    @PostMapping("/filter")
    public ApiResponse addVideoFilter(
            @ApiParam(value = "视频ID", required = true) @RequestParam Long videoId,
            @ApiParam(value = "滤镜类型", required = true) @RequestParam String filterType,
            @ApiParam(value = "滤镜参数", required = true) @RequestBody Map<String, Object> filterParams) {
        return videoEditService.addVideoFilter(videoId, filterType, filterParams);
    }

    /**
     * 添加视频文字
     *
     * @param videoId    视频ID
     * @param text       文字内容
     * @param startTime  文字显示开始时间（秒）
     * @param duration   文字显示持续时间（秒）
     * @param textStyle  文字样式参数
     * @return 包含添加文字结果的ApiResponse对象
     */
    @ApiOperation("添加视频文字")
    @PostMapping("/text")
    public ApiResponse addVideoText(
            @ApiParam(value = "视频ID", required = true) @RequestParam Long videoId,
            @ApiParam(value = "文字内容", required = true) @RequestParam String text,
            @ApiParam(value = "文字显示开始时间（秒）", required = true) @RequestParam Integer startTime,
            @ApiParam(value = "文字显示持续时间（秒）", required = true) @RequestParam Integer duration,
            @ApiParam(value = "文字样式参数", required = true) @RequestBody Map<String, Object> textStyle) {
        return videoEditService.addVideoText(videoId, text, startTime, duration, textStyle);
    }

    /**
     * 获取编辑进度
     *
     * @param taskId 任务ID
     * @return 包含编辑进度的ApiResponse对象
     */
    @ApiOperation("获取编辑进度")
    @GetMapping("/progress/{taskId}")
    public ApiResponse getEditProgress(
            @ApiParam(value = "任务ID", required = true) @PathVariable String taskId) {
        return videoEditService.getEditProgress(taskId);
    }
} 